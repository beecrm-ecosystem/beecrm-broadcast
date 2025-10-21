import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DiogenesService } from '../services/diogenes.service';
import {
  CampaignWebhookService,
  BroadcastMessageSummary,
} from '../services/campaign-webhook.service';

export interface SendMessageJob {
  campaignId: string;
  recipientId: string;
  recipientPhone: string;
  recipientName: string;
  recipientVariables: Record<string, any>;
  templateData: any;
  channel: string;
  templateName: string;
  templateLanguage: string;
}

@Processor('broadcast-queue')
export class BroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(BroadcastProcessor.name);
  // Cache para controlar envio de webhooks de progresso
  private readonly progressCache = new Map<string, { lastSent: number; lastCount: number }>();
  // Envia webhook a cada X mensagens ou Y segundos
  private readonly PROGRESS_THRESHOLD = 10; // Mensagens
  private readonly PROGRESS_INTERVAL = 30000; // 30 segundos

  constructor(
    private readonly prisma: PrismaService,
    private readonly diogenesService: DiogenesService,
    private readonly campaignWebhookService: CampaignWebhookService,
  ) {
    super();
  }

  async process(job: Job<SendMessageJob>): Promise<any> {
    const {
      campaignId,
      recipientId,
      recipientPhone,
      recipientName,
      recipientVariables,
      templateData,
      channel,
      templateName,
      templateLanguage,
    } = job.data;

    this.logger.log(
      `Processando envio para ${recipientName} (${recipientPhone}) - Campanha: ${campaignId}`,
    );

    try {
      // Monta os componentes do template
      const components = this.diogenesService.buildTemplateComponents(
        templateData,
        recipientVariables,
      );

      // Envia via Diogenes
      const response = await this.diogenesService.sendTemplate(channel, {
        number: recipientPhone,
        name: templateName,
        language: templateLanguage,
        components,
      });

      // Salva a mensagem no banco com o ID retornado
      const message = await this.prisma.message.create({
        data: {
          campaignId,
          recipientId,
          templateId: templateData.id || templateName,
          externalId: response.key.id, // ID do WhatsApp
          phoneNumber: recipientPhone,
          status: 'SENT',
          sentAt: new Date(),
          metadata: {
            remoteJid: response.key.remoteJid,
            messageType: response.messageType,
            messageTimestamp: response.messageTimestamp,
            instanceId: response.instanceId,
            diogenes_status: response.status,
          },
        },
      });

      // Atualiza o status do destinatário
      await this.prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      // Atualiza contadores da campanha
      const updatedCampaign = await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          sentCount: { increment: 1 },
        },
      });

      // Envia webhook de progresso (throttled)
      await this.sendProgressWebhook(updatedCampaign);

      // Verifica se todos os destinatários foram processados
      await this.checkAndCompleteCampaign(campaignId);

      this.logger.log(
        `Mensagem enviada com sucesso! ID: ${message.id} | External ID: ${response.key.id}`,
      );

      return {
        success: true,
        messageId: message.id,
        externalId: response.key.id,
      };
    } catch (error) {
      this.logger.error(`Erro ao processar envio para ${recipientPhone}: ${error.message}`);

      // Verifica se é um erro permanente (não deve fazer retry)
      const isPermanentError =
        error.response?.status && [400, 401, 403, 404, 422].includes(error.response.status);

      if (isPermanentError) {
        this.logger.error(`Erro permanente (${error.response.status}) - não será feito retry`);
      }

      // Marca como falha no banco
      await this.prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'FAILED',
          metadata: {
            error: error.message,
            errorCode: error.response?.status || 'UNKNOWN',
            failedAt: new Date(),
            attemptNumber: job.attemptsMade,
          },
        },
      });

      // Atualiza contador de falhas
      const updatedCampaign = await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          failedCount: { increment: 1 },
        },
      });

      // Envia webhook de progresso (throttled)
      await this.sendProgressWebhook(updatedCampaign);

      // Verifica se todos os destinatários foram processados
      await this.checkAndCompleteCampaign(campaignId);

      // Se for erro permanente, não faz retry (retorna sucesso para o BullMQ não tentar novamente)
      if (isPermanentError) {
        this.logger.warn(`Job marcado como concluído (falha permanente)`);
        return {
          success: false,
          error: error.message,
          permanent: true,
        };
      }

      // Para erros temporários (500, timeout, etc), faz retry
      throw error;
    }
  }

  /**
   * Envia webhook de progresso (com throttling para não sobrecarregar)
   */
  private async sendProgressWebhook(campaign: any): Promise<void> {
    try {
      const now = Date.now();
      const cached = this.progressCache.get(campaign.id);
      const processedCount = campaign.sentCount + campaign.failedCount;
      const isComplete = processedCount >= campaign.totalRecipients;

      // Se a campanha está completa, não envia aqui (será enviado no checkAndCompleteCampaign)
      if (isComplete) {
        this.logger.debug(
          `⏭️ Campanha ${campaign.id} completa, webhook será enviado na finalização`,
        );
        return;
      }

      // Não envia webhook se:
      // 1. Já enviou recentemente (< 30s) E
      // 2. A diferença de mensagens processadas é pequena (< 10)
      if (cached) {
        const timeSinceLastSent = now - cached.lastSent;
        const countDifference = processedCount - cached.lastCount;

        if (
          timeSinceLastSent < this.PROGRESS_INTERVAL &&
          countDifference < this.PROGRESS_THRESHOLD
        ) {
          this.logger.debug(
            `⏸️ Throttling webhook: tempo=${timeSinceLastSent}ms, diff=${countDifference}`,
          );
          return;
        }
      }

      // Atualiza cache
      this.progressCache.set(campaign.id, {
        lastSent: now,
        lastCount: processedCount,
      });

      // Envia webhook com métricas atualizadas
      await this.campaignWebhookService.sendBroadcastSummary(campaign, {
        status: campaign.status,
        totalContacts: campaign.totalRecipients,
        failedContacts: campaign.failedCount,
      });

      this.logger.debug(
        `📊 Webhook de progresso enviado: ${campaign.id} (${processedCount}/${campaign.totalRecipients})`,
      );
    } catch (error) {
      this.logger.error(`Erro ao enviar webhook de progresso: ${error.message}`);
    }
  }

  /**
   * Verifica se todos os destinatários foram processados e completa a campanha
   */
  private async checkAndCompleteCampaign(campaignId: string) {
    this.logger.debug(`🔍 Verificando conclusão da campanha ${campaignId}`);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || campaign.status !== 'PROCESSING') {
      this.logger.debug(
        `⏭️ Campanha ${campaignId} não está em processamento (status=${campaign?.status ?? 'NOT_FOUND'})`,
      );
      return;
    }

    const processedCount = campaign.sentCount + campaign.failedCount;
    this.logger.debug(
      `📊 Campanha ${campaignId}: processados=${processedCount}, total=${campaign.totalRecipients} (sent=${campaign.sentCount}, failed=${campaign.failedCount})`,
    );

    // Se todos os destinatários foram processados, marca como completada
    if (processedCount >= campaign.totalRecipients) {
      this.logger.log(`🏁 Todos destinatários processados! Finalizando campanha ${campaignId}`);
      const completedCampaign = await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      const { successMessages, failedMessages } = await this.buildCompletionSummaries(campaignId);

      // Limpa cache de progresso
      this.progressCache.delete(campaignId);

      this.logger.log(
        `✅ Campanha ${campaignId} completada! Total: ${campaign.totalRecipients}, Enviados: ${campaign.sentCount}, Falhas: ${campaign.failedCount}`,
      );
      this.logger.log(
        `📦 Preparando webhook final (sucesso=${successMessages.length}, falhas=${failedMessages.length}) para campanha ${campaignId}`,
      );

      // Envia webhook final de conclusão
      await this.campaignWebhookService.sendUpdateStatus(completedCampaign);
      await this.campaignWebhookService.sendBroadcastSummary(completedCampaign, {
        status: 'COMPLETED',
        totalContacts: completedCampaign.totalRecipients,
        sentContacts: completedCampaign.sentCount,
        failedContacts: completedCampaign.failedCount,
        pendingContacts: 0,
        successMessages,
        failedMessages,
      });
      this.logger.log(`📬 Webhooks finais enviados para campanha ${campaignId}`);
    }
  }

  private async buildCompletionSummaries(campaignId: string): Promise<{
    successMessages: BroadcastMessageSummary[];
    failedMessages: BroadcastMessageSummary[];
  }> {
    const [successfulRecipients, failedRecipients] = await Promise.all([
      this.prisma.campaignRecipient.findMany({
        where: {
          campaignId,
          isActive: true,
          status: {
            in: ['SENT', 'DELIVERED', 'READ'],
          },
        },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          status: true,
          metadata: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              externalId: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
              failedAt: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      }),
      this.prisma.campaignRecipient.findMany({
        where: {
          campaignId,
          isActive: true,
          status: 'FAILED',
        },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          status: true,
          metadata: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              externalId: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
              failedAt: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      }),
    ]);

    const successMessages = successfulRecipients.map((recipient) =>
      this.mapRecipientSummary(recipient),
    );
    const failedMessages = failedRecipients.map((recipient) => this.mapRecipientSummary(recipient));

    return { successMessages, failedMessages };
  }

  private mapRecipientSummary(recipient: {
    id: string;
    phoneNumber: string;
    name: string | null;
    status: MessageStatus;
    metadata: any;
    messages: Array<{
      id: string;
      externalId: string | null;
      status: MessageStatus;
      sentAt: Date | null;
      deliveredAt: Date | null;
      readAt: Date | null;
      failedAt: Date | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
  }): BroadcastMessageSummary {
    const [lastMessage] = recipient.messages;
    const metadata = this.normalizeMetadata(recipient.metadata);

    return {
      recipientId: recipient.id,
      phoneNumber: recipient.phoneNumber,
      name: recipient.name,
      status: recipient.status,
      messageId: lastMessage?.id ?? null,
      externalId: lastMessage?.externalId ?? metadata.externalId ?? null,
      sentAt: lastMessage?.sentAt ?? metadata.sentAt ?? null,
      deliveredAt: lastMessage?.deliveredAt ?? metadata.deliveredAt ?? null,
      readAt: lastMessage?.readAt ?? metadata.readAt ?? null,
      failedAt: lastMessage?.failedAt ?? metadata.failedAt ?? null,
      errorCode: lastMessage?.errorCode ?? metadata.errorCode ?? null,
      errorMessage: lastMessage?.errorMessage ?? metadata.error ?? metadata.errorMessage ?? null,
    };
  }

  private normalizeMetadata(metadata: any): Record<string, any> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata as Record<string, any>;
  }
}

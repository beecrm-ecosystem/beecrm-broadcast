import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SendMessageJob } from '../queues/broadcast.processor';

interface EnqueueCampaignOptions {
  recipientIds?: string[];
  allowEmpty?: boolean;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('broadcast-queue') private broadcastQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Enfileira todos os destinatários de uma campanha
   */
  async enqueueCampaign(campaignId: string, options: EnqueueCampaignOptions = {}) {
    const { recipientIds, allowEmpty = false } = options;

    this.logger.log(`Enfileirando campanha: ${campaignId}`);

    // Busca a campanha com dados do template
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error(`Campanha ${campaignId} não encontrada`);
    }

    const recipientWhere: any = {
      campaignId,
      isActive: true,
      status: MessageStatus.PENDING,
    };

    if (recipientIds?.length) {
      recipientWhere.id = { in: recipientIds };
    }

    // Busca todos os destinatários ativos elegíveis
    const recipients = await this.prisma.campaignRecipient.findMany({
      where: recipientWhere,
    });

    if (recipients.length === 0) {
      if (allowEmpty) {
        this.logger.log(`Nenhum destinatário pendente encontrado para campanha ${campaign.name}`);
        return {
          totalEnqueued: 0,
          batches: 0,
          batchSize: campaign.batchSize,
          delayBetweenBatches: campaign.delayBetweenBatches,
        };
      }

      throw new Error('Nenhum destinatário pendente encontrado');
    }

    const recipientIdsToQueue = recipients.map((recipient) => recipient.id);

    await this.prisma.campaignRecipient.updateMany({
      where: {
        id: {
          in: recipientIdsToQueue,
        },
      },
      data: {
        status: MessageStatus.QUEUED,
      },
    });

    this.logger.log(`Enfileirando ${recipients.length} destinatários da campanha ${campaign.name}`);

    const templateData = campaign.templateData as any;

    // Adiciona cada destinatário na fila com delay progressivo
    const jobs = recipients.map((recipient, index) => {
      const batchNumber = Math.floor(index / campaign.batchSize);
      const delay = batchNumber * campaign.delayBetweenBatches;

      const jobData: SendMessageJob = {
        campaignId: campaign.id,
        recipientId: recipient.id,
        recipientPhone: recipient.phoneNumber,
        recipientName: recipient.name || 'Cliente',
        recipientVariables: this.buildRecipientVariables(recipient),
        templateData: templateData,
        channel: campaign.channel,
        templateName: templateData.name || campaign.templateId,
        templateLanguage: templateData.language || 'pt_BR',
      };

      return {
        name: `send-${campaign.id}-${recipient.id}`,
        data: jobData,
        opts: {
          delay,
          attempts: 2, // Tenta 2 vezes em caso de falha (1 original + 1 retry)
          backoff: {
            type: 'exponential',
            delay: 3000, // 3s, depois 6s
          },
          removeOnComplete: {
            age: 3600, // Remove jobs completados após 1 hora
            count: 1000, // Mantém apenas os últimos 1000
          },
          removeOnFail: {
            age: 86400, // Remove jobs falhados após 24 horas
          },
        },
      };
    });

    try {
      // Adiciona todos os jobs em lote
      await this.broadcastQueue.addBulk(jobs);
    } catch (error) {
      // Se falhar, retorna os destinatários para o status pendente
      await this.prisma.campaignRecipient.updateMany({
        where: {
          id: {
            in: recipientIdsToQueue,
          },
        },
        data: {
          status: MessageStatus.PENDING,
        },
      });

      throw error;
    }

    this.logger.log(
      `${jobs.length} mensagens enfileiradas com sucesso! Lotes: ${Math.ceil(recipients.length / campaign.batchSize)}`,
    );

    return {
      totalEnqueued: jobs.length,
      batches: Math.ceil(recipients.length / campaign.batchSize),
      batchSize: campaign.batchSize,
      delayBetweenBatches: campaign.delayBetweenBatches,
    };
  }

  /**
   * Obtém estatísticas da fila
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.broadcastQueue.getWaitingCount(),
      this.broadcastQueue.getActiveCount(),
      this.broadcastQueue.getCompletedCount(),
      this.broadcastQueue.getFailedCount(),
      this.broadcastQueue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Pausa a fila (pausa o processamento)
   */
  async pauseQueue() {
    await this.broadcastQueue.pause();
    this.logger.log('Fila pausada');
    return { message: 'Fila pausada com sucesso' };
  }

  /**
   * Retoma a fila
   */
  async resumeQueue() {
    await this.broadcastQueue.resume();
    this.logger.log('Fila retomada');
    return { message: 'Fila retomada com sucesso' };
  }

  /**
   * Limpa jobs completados
   */
  async cleanQueue() {
    await this.broadcastQueue.clean(0, 1000, 'completed');
    await this.broadcastQueue.clean(0, 1000, 'failed');
    this.logger.log('Fila limpa');
    return { message: 'Fila limpa com sucesso' };
  }

  /**
   * Remove jobs de uma campanha específica
   */
  async removeCampaignJobs(campaignId: string) {
    const jobs = await this.broadcastQueue.getJobs(['waiting', 'delayed', 'active']);

    const campaignJobs = jobs.filter((job) => job.data.campaignId === campaignId);

    await Promise.all(campaignJobs.map((job) => job.remove()));

    const recipientIds = Array.from(
      new Set(
        campaignJobs.map((job) => job.data?.recipientId).filter((id): id is string => Boolean(id)),
      ),
    );

    if (recipientIds.length > 0) {
      await this.prisma.campaignRecipient.updateMany({
        where: {
          id: {
            in: recipientIds,
          },
        },
        data: {
          status: MessageStatus.PENDING,
        },
      });
    }

    this.logger.log(`${campaignJobs.length} jobs da campanha ${campaignId} removidos`);

    return {
      removed: campaignJobs.length,
      message: `${campaignJobs.length} jobs removidos da fila`,
    };
  }

  private buildRecipientVariables(recipient: {
    name: string | null;
    variables: any;
    email?: string | null;
  }): Record<string, any> {
    const variables = this.normalizeVariables(recipient.variables);
    const fallbackName = recipient.name ?? 'Cliente';

    const nameValue = String(fallbackName);

    if (!variables.NAME) {
      variables.NAME = nameValue;
    }

    if (!variables.name) {
      variables.name = nameValue;
    }

    if (!variables['1']) {
      variables['1'] = nameValue;
    }

    if (recipient.email && !variables.email) {
      variables.email = String(recipient.email);
    }

    return variables;
  }

  private normalizeVariables(rawVariables: any): Record<string, any> {
    if (!rawVariables) {
      return {};
    }

    if (typeof rawVariables === 'string') {
      try {
        const parsed = JSON.parse(rawVariables);
        return this.normalizeVariables(parsed);
      } catch (error) {
        this.logger.warn(
          `Não foi possível converter variáveis do destinatário: ${rawVariables}`,
          error instanceof Error ? error.message : String(error),
        );
        return {};
      }
    }

    if (typeof rawVariables === 'object' && !Array.isArray(rawVariables)) {
      return { ...(rawVariables as Record<string, any>) };
    }

    return {};
  }
}

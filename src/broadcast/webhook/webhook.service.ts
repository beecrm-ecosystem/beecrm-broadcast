import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DiogenesWebhookDto } from './webhook.controller';
import { RcsWebhookDto } from './rcs-webhook.dto';
import { MessageStatus } from '@prisma/client';

interface MetaStatusUpdate {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
  }>;
}

interface MetaMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

interface MetaIncomingMessage {
  id: string;
  from?: string;
  timestamp?: string;
  type: string;
  text?: {
    body: string;
  };
  interactive?: {
    type?: string;
    button_reply?: {
      id: string;
      title?: string;
    };
    list_reply?: {
      id: string;
      title?: string;
    };
  };
  image?: {
    id?: string;
    link?: string;
    caption?: string;
  };
  document?: {
    id?: string;
    link?: string;
    filename?: string;
    caption?: string;
  };
  audio?: {
    id?: string;
    link?: string;
  };
  video?: {
    id?: string;
    link?: string;
    caption?: string;
  };
  sticker?: {
    id?: string;
    link?: string;
  };
  context?: {
    id?: string;
    from?: string;
  };
  [key: string]: any;
}

const ENGAGEMENT_WINDOW_SECONDS = 24 * 60 * 60; // 24 horas

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processa webhook do Meta WhatsApp Business API
   */
  async processMetaWebhook(status: MetaStatusUpdate, metadata: MetaMetadata) {
    const messageId = status.id; // wamid.xxx
    const whatsappStatus = status.status;
    const recipientPhone = status.recipient_id;

    // Busca a mensagem pelo whatsappMessageId
    const message = await this.prisma.message.findFirst({
      where: {
        OR: [{ whatsappMessageId: messageId }, { externalId: messageId }],
      },
      include: {
        campaign: true,
        recipient: true,
      },
    });

    if (!message) {
      // Tenta buscar pelo telefone do destinatário (fallback)
      const messageByPhone = await this.findMessageByPhone(recipientPhone);
      if (messageByPhone) {
        // Salva o evento do webhook apenas quando a mensagem é encontrada
        const webhookEvent = await this.prisma.webhookEvent.create({
          data: {
            provider: 'meta',
            event: 'message_status',
            eventType: `status.${whatsappStatus}`,
            whatsappMessageId: messageId,
            status: whatsappStatus,
            timestamp: new Date(parseInt(status.timestamp) * 1000),
            payload: { status, metadata } as any,
            processed: false,
          },
        });

        this.logger.log(
          `📨 Webhook de campanha recebido (campaign=${messageByPhone.campaignId}, message=${messageByPhone.id}, status=${whatsappStatus})`,
        );
        await this.updateMessageStatus(messageByPhone, whatsappStatus, status, webhookEvent.id);
      }
      return;
    }

    // Salva o evento do webhook apenas quando a mensagem é encontrada
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        provider: 'meta',
        event: 'message_status',
        eventType: `status.${whatsappStatus}`,
        whatsappMessageId: messageId,
        status: whatsappStatus,
        timestamp: new Date(parseInt(status.timestamp) * 1000),
        payload: { status, metadata } as any,
        processed: false,
      },
    });

    this.logger.log(
      `📨 Webhook de campanha recebido (campaign=${message.campaignId}, message=${message.id}, status=${whatsappStatus})`,
    );
    await this.updateMessageStatus(message, whatsappStatus, status, webhookEvent.id);
  }

  private async updateMessageStatus(
    message: any,
    metaStatus: string,
    statusPayload: MetaStatusUpdate,
    webhookEventId: string,
  ) {
    const newStatus = this.mapMetaStatusToMessageStatus(metaStatus);
    const eventTimestamp = this.resolveMessageTimestamp(statusPayload?.timestamp);

    // Usa transaction para evitar race condition em webhooks simultâneos
    await this.prisma.$transaction(async (tx) => {
      // Re-lê a mensagem dentro da transaction para pegar o status mais recente
      const freshMessage = await tx.message.findUnique({
        where: { id: message.id },
      });

      if (!freshMessage) return;

      const previousStatus = freshMessage.status as MessageStatus | undefined;

      // Guard: ignora se o status é o mesmo
      if (previousStatus === newStatus) return;

      const messageUpdate: any = {
        status: newStatus,
        metadata: {
          ...(freshMessage.metadata as Record<string, unknown>),
          lastWebhookStatus: metaStatus,
          lastWebhookEventId: webhookEventId,
          lastWebhookAt: eventTimestamp,
          lastWebhookErrors: statusPayload.errors ?? [],
        },
      };

      if (newStatus === 'DELIVERED') {
        messageUpdate.deliveredAt = eventTimestamp;
      }

      if (newStatus === 'READ') {
        messageUpdate.readAt = eventTimestamp;
      }

      if (newStatus === 'FAILED') {
        messageUpdate.failedAt = eventTimestamp;

        if (statusPayload.errors?.length) {
          const [firstError] = statusPayload.errors;
          messageUpdate.errorCode = String(firstError.code ?? '');
          messageUpdate.errorMessage = firstError.message ?? firstError.title ?? null;
          messageUpdate.errorDetails = statusPayload.errors as any;
        }
      }

      await tx.message.update({
        where: { id: freshMessage.id },
        data: messageUpdate,
      });

      if (message.recipientId) {
        const recipientUpdate: any = { status: newStatus };

        if (newStatus === 'DELIVERED') {
          recipientUpdate.deliveredAt = eventTimestamp;
        }

        if (newStatus === 'READ') {
          recipientUpdate.readAt = eventTimestamp;
        }

        if (newStatus === 'FAILED') {
          recipientUpdate.isActive = false;
        }

        await tx.campaignRecipient.update({
          where: { id: message.recipientId },
          data: recipientUpdate,
        });
      }

      // Atualiza contadores fora da transaction (usa increment atômico)
      await this.updateCampaignCounters(message.campaignId, newStatus, previousStatus);
    });

    try {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          messageId: message.id,
          processed: true,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.debug(
        `Não foi possível vincular webhookEvent ${webhookEventId} à mensagem ${message.id}: ${String(error)}`,
      );
    }

    this.logger.debug(
      `Status da mensagem ${message.id} atualizado → ${newStatus} (meta=${metaStatus})`,
    );
  }

  /**
   * Processa mensagens recebidas pelo Meta (respostas de destinatários)
   */
  async processMetaMessage(message: MetaIncomingMessage, metadata: MetaMetadata) {
    if (!message?.id) {
      this.logger.warn('Mensagem recebida sem ID - ignorando');
      return;
    }

    const whatsappMessageId = message.id;
    const fromPhoneRaw = message.from ?? '';
    const normalizedFrom = this.normalizePhoneNumber(fromPhoneRaw);
    const campaignResponseRepo = (this.prisma as any).campaignResponse;

    if (!normalizedFrom) {
      this.logger.warn(`Mensagem ${whatsappMessageId} sem número de origem - ignorando`);
      return;
    }

    if (!campaignResponseRepo) {
      this.logger.error('Repositório campaignResponse não disponível no PrismaService');
      return;
    }

    const existingResponse = await campaignResponseRepo.findUnique({
      where: { whatsappMessageId },
    });

    if (existingResponse) {
      this.logger.debug(`Resposta ${whatsappMessageId} já processada anteriormente`);
      return;
    }

    const receivedAt = this.resolveMessageTimestamp(message.timestamp);

    // Tenta identificar mensagem original usando contexto (ID do template enviado)
    let relatedMessage: any = null;
    if (message.context?.id) {
      relatedMessage = await this.prisma.message.findFirst({
        where: {
          OR: [{ whatsappMessageId: message.context.id }, { externalId: message.context.id }],
        },
        include: {
          campaign: true,
          recipient: true,
        },
      });
    }

    if (!relatedMessage) {
      relatedMessage = await this.findMessageByPhone(normalizedFrom);
    }

    let recipientRecord: any = relatedMessage?.recipient;
    if (!recipientRecord) {
      recipientRecord = await this.findRecipientByPhone(normalizedFrom);
    }

    const campaignId = relatedMessage?.campaignId ?? recipientRecord?.campaignId;

    if (!campaignId) {
      this.logger.warn(
        `Resposta recebida sem campanha associada: ${whatsappMessageId} (from=${normalizedFrom})`,
      );
      return;
    }

    const responseType = this.resolveResponseType(message);
    const textBody = this.extractResponseText(message);
    const mediaUrl = this.extractMediaUrl(message);
    const optOutMatch = this.detectOptOut({ message, textBody });

    const messageSentAt =
      relatedMessage?.sentAt ??
      relatedMessage?.queuedAt ??
      relatedMessage?.createdAt ??
      recipientRecord?.sentAt ??
      recipientRecord?.createdAt ??
      null;

    const responseTimeSeconds = this.calculateResponseTimeSeconds(messageSentAt, receivedAt);

    await campaignResponseRepo.create({
      data: {
        campaignId,
        recipientId: recipientRecord?.id ?? null,
        messageId: relatedMessage?.id ?? null,
        whatsappMessageId,
        fromPhone: normalizedFrom,
        responseType,
        textBody,
        mediaUrl,
        metadata: {
          displayPhoneNumber: metadata.display_phone_number,
          phoneNumberId: metadata.phone_number_id,
          optOutDetected: Boolean(optOutMatch),
          ...(optOutMatch ? { optOutReason: optOutMatch.reason } : {}),
        } as any,
        responsePayload: message as any,
        receivedAt,
        responseTimeSeconds,
      },
    });

    await this.updateResponseCounters({
      campaignId,
      recipient: recipientRecord,
      responseTimestamp: receivedAt,
      responseTimeSeconds,
    });

    if (optOutMatch && recipientRecord?.id) {
      await this.handleOptOut({
        campaignId,
        recipient: recipientRecord,
        timestamp: receivedAt,
        reason: optOutMatch.reason,
      });
    }

    this.logger.log(
      `💬 Resposta registrada (campaign=${campaignId}, recipient=${recipientRecord?.id ?? 'n/a'}, message=${whatsappMessageId})`,
    );
  }

  /**
   * Processa webhook do formato legado Diogenes
   */
  async processDiogenesWebhook(payload: DiogenesWebhookDto) {
    const { event, data } = payload;
    const externalId = data.key.id;

    // Busca a mensagem pelo externalId
    const message = await this.prisma.message.findFirst({
      where: { externalId },
      include: {
        campaign: true,
        recipient: true,
      },
    });

    if (!message) {
      return;
    }

    // Salva o evento do webhook apenas quando a mensagem é encontrada
    await this.prisma.webhookEvent.create({
      data: {
        provider: 'diogenes',
        event,
        payload: payload as any,
        messageId: message.id,
        processed: false,
      },
    });

    // Mapeia o evento para o status
    const statusMap: Record<string, MessageStatus> = {
      'messages.upsert': 'SENT',
      'messages.update': 'DELIVERED',
      'message.status.update': this.getStatusFromWebhook(data.status),
      'send.message': 'SENT',
    };

    const newStatus = statusMap[event];

    if (!newStatus) {
      this.logger.warn(`Evento não mapeado: ${event}`);
      return;
    }

    const previousStatus = message.status as MessageStatus | undefined;

    // Atualiza a mensagem
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        status: newStatus,
        ...(newStatus === 'DELIVERED' && { deliveredAt: new Date() }),
        ...(newStatus === 'READ' && { readAt: new Date() }),
        ...(newStatus === 'FAILED' && { failedAt: new Date() }),
        metadata: {
          ...(message.metadata as any),
          lastWebhookEvent: event,
          lastWebhookStatus: data.status,
          lastWebhookAt: new Date(),
        },
      },
    });

    // Atualiza o destinatário
    await this.prisma.campaignRecipient.update({
      where: { id: message.recipientId },
      data: {
        status: newStatus,
        ...(newStatus === 'DELIVERED' && { deliveredAt: new Date() }),
        ...(newStatus === 'READ' && { readAt: new Date() }),
      },
    });

    // Atualiza contadores da campanha
    await this.updateCampaignCounters(message.campaignId, newStatus, previousStatus);

    this.logger.log(`Mensagem ${message.id} atualizada para status: ${newStatus}`);
  }

  /**
   * Processa webhook de status RCS da Pontaltech
   */
  async processRcsWebhook(payload: RcsWebhookDto) {
    const rcsMessageId = payload.messageId;
    const rcsStatus = payload.status;
    const recipientPhone = payload.phone;

    if (!rcsMessageId && !recipientPhone) {
      this.logger.warn('Webhook RCS recebido sem messageId nem phone - ignorando');
      return;
    }

    // Busca a mensagem pelo providerMessageId (campo generico) ou externalId
    let message: any = null;

    if (rcsMessageId) {
      message = await this.prisma.message.findFirst({
        where: {
          OR: [{ providerMessageId: rcsMessageId }, { externalId: rcsMessageId }],
        },
        include: {
          campaign: true,
          recipient: true,
        },
      });
    }

    // Fallback: busca pelo telefone do destinatario
    if (!message && recipientPhone) {
      message = await this.findMessageByPhone(recipientPhone);
    }

    if (!message) {
      this.logger.warn(
        `Mensagem RCS nao encontrada (messageId=${rcsMessageId}, phone=${recipientPhone}) - ignorando`,
      );
      return;
    }

    const newStatus = this.mapRcsStatusToMessageStatus(rcsStatus);
    const previousStatus = message.status as MessageStatus | undefined;
    const eventTimestamp = payload.timestamp
      ? this.resolveMessageTimestamp(payload.timestamp)
      : new Date();

    // Salva o evento do webhook
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        provider: 'pontaltech',
        event: 'rcs_status',
        eventType: payload.eventType || `status.${rcsStatus}`,
        whatsappMessageId: rcsMessageId,
        status: rcsStatus,
        timestamp: eventTimestamp,
        payload: payload as any,
        processed: false,
      },
    });

    this.logger.log(
      `Webhook RCS recebido (campaign=${message.campaignId}, message=${message.id}, status=${rcsStatus})`,
    );

    // Atualiza a mensagem
    const messageUpdate: any = {
      status: newStatus,
      metadata: {
        ...(message.metadata as Record<string, unknown>),
        lastWebhookStatus: rcsStatus,
        lastWebhookEventId: webhookEvent.id,
        lastWebhookAt: eventTimestamp,
        lastWebhookProvider: 'pontaltech',
        ...(payload.errorCode ? { lastWebhookErrorCode: payload.errorCode } : {}),
        ...(payload.errorMessage ? { lastWebhookErrorMessage: payload.errorMessage } : {}),
      },
    };

    if (newStatus === 'DELIVERED') {
      messageUpdate.deliveredAt = eventTimestamp;
    }

    if (newStatus === 'READ') {
      messageUpdate.readAt = eventTimestamp;
    }

    if (newStatus === 'FAILED') {
      messageUpdate.failedAt = eventTimestamp;

      if (payload.errorCode || payload.errorMessage) {
        messageUpdate.errorCode = payload.errorCode ?? null;
        messageUpdate.errorMessage = payload.errorMessage ?? null;
        messageUpdate.errorDetails = {
          provider: 'pontaltech',
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
        } as any;
      }
    }

    await this.prisma.message.update({
      where: { id: message.id },
      data: messageUpdate,
    });

    // Atualiza o destinatario
    if (message.recipientId) {
      const recipientUpdate: any = { status: newStatus };

      if (newStatus === 'DELIVERED') {
        recipientUpdate.deliveredAt = eventTimestamp;
      }

      if (newStatus === 'READ') {
        recipientUpdate.readAt = eventTimestamp;
      }

      if (newStatus === 'FAILED') {
        recipientUpdate.isActive = false;
      }

      await this.prisma.campaignRecipient.update({
        where: { id: message.recipientId },
        data: recipientUpdate,
      });
    }

    // Atualiza contadores da campanha
    await this.updateCampaignCounters(message.campaignId, newStatus, previousStatus);

    // Marca o webhook como processado
    try {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          messageId: message.id,
          processed: true,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.debug(
        `Nao foi possivel vincular webhookEvent ${webhookEvent.id} a mensagem ${message.id}: ${String(error)}`,
      );
    }

    this.logger.debug(
      `Status da mensagem RCS ${message.id}: ${previousStatus ?? 'unknown'} -> ${newStatus} (pontaltech=${rcsStatus})`,
    );
  }

  /**
   * Mapeia status da Pontaltech (RCS) para o enum MessageStatus interno
   */
  private mapRcsStatusToMessageStatus(rcsStatus?: string): MessageStatus {
    if (!rcsStatus) return 'SENT';

    const statusMap: Record<string, MessageStatus> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      displayed: 'READ',
      read: 'READ',
      failed: 'FAILED',
      error: 'FAILED',
      expired: 'FAILED',
      rejected: 'REJECTED',
      undelivered: 'FAILED',
    };

    return statusMap[rcsStatus.toLowerCase()] || 'SENT';
  }

  /**
   * Atualiza o status da mensagem com base no webhook do Meta
   */
  private mapMetaStatusToMessageStatus(metaStatus: string): MessageStatus {
    const statusMap: Record<string, MessageStatus> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
      deleted: 'FAILED',
      undelivered: 'FAILED',
    };

    return statusMap[metaStatus.toLowerCase()] || 'SENT';
  }

  /**
   * Mapeia status do webhook para MessageStatus
   */
  private getStatusFromWebhook(status?: string): MessageStatus {
    if (!status) return 'SENT';

    const statusMap: Record<string, MessageStatus> = {
      PENDING: 'SENT',
      SERVER_ACK: 'SENT',
      DELIVERY_ACK: 'DELIVERED',
      READ: 'READ',
      PLAYED: 'READ',
      ERROR: 'FAILED',
      DELETED: 'FAILED',
    };

    return statusMap[status.toUpperCase()] || 'SENT';
  }

  /**
   * Atualiza contadores da campanha baseado no novo status.
   *
   * Contadores são EXCLUSIVOS: cada mensagem está em exatamente um bucket.
   * sentCount + failedCount + pendingCount = totalRecipients (invariante).
   * deliveredCount e readCount são sub-métricas dentro de sentCount.
   * Quando uma mensagem muda de SENT → FAILED, sentCount decrementa e failedCount incrementa.
   */
  private async updateCampaignCounters(
    campaignId: string,
    newStatus: MessageStatus,
    previousStatus?: MessageStatus,
  ) {
    const updateData: any = {};

    if (previousStatus && previousStatus === newStatus) {
      return;
    }

    // REGRA: sentCount e failedCount NUNCA decrementam (são os contadores principais)
    // deliveredCount e readCount são métricas adicionais que podem decrementar

    // Contadores são EXCLUSIVOS: cada mensagem conta em exatamente um bucket.
    // sentCount + failedCount + pendingCount = totalRecipients (sempre)
    // deliveredCount e readCount são sub-métricas de sentCount.

    // Decrementa o contador do status anterior
    if (previousStatus) {
      switch (previousStatus) {
        case 'SENT':
          // Decrementa sentCount ao sair de SENT (ex: SENT → FAILED)
          if (newStatus === 'FAILED') {
            updateData.sentCount = { decrement: 1 };
          }
          break;
        case 'DELIVERED':
          updateData.deliveredCount = { decrement: 1 };
          break;
        case 'READ':
          updateData.readCount = { decrement: 1 };
          break;
        case 'FAILED':
          break;
      }
    }

    // Incrementa o contador do novo status
    switch (newStatus) {
      case 'SENT':
        if (!previousStatus) {
          updateData.sentCount = { increment: 1 };
        }
        break;
      case 'DELIVERED':
        updateData.deliveredCount = { increment: 1 };
        break;
      case 'READ':
        updateData.readCount = { increment: 1 };
        break;
      case 'FAILED':
        if (previousStatus !== 'FAILED') {
          updateData.failedCount = { increment: 1 };
        }
        break;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: updateData,
      });

      // Log apenas em debug
      this.logger.debug(`Contadores ${campaignId}: ${previousStatus} → ${newStatus}`);
    }
  }

  private normalizePhoneNumber(phone?: string): string {
    if (!phone) {
      return '';
    }
    return phone.replace(/\D/g, '');
  }

  private resolveMessageTimestamp(rawTimestamp?: string): Date {
    if (!rawTimestamp) {
      return new Date();
    }

    const numeric = Number(rawTimestamp);

    if (!Number.isFinite(numeric)) {
      return new Date();
    }

    if (numeric > 1_000_000_000_000) {
      return new Date(numeric);
    }

    return new Date(numeric * 1000);
  }

  private resolveResponseType(message: MetaIncomingMessage): string {
    if (message.type === 'interactive' && message.interactive?.type) {
      return `interactive:${message.interactive.type}`;
    }

    return message.type || 'unknown';
  }

  private extractResponseText(message: MetaIncomingMessage): string | null {
    if (message.type === 'text' && message.text?.body) {
      return message.text.body;
    }

    if (message.type === 'interactive') {
      const buttonTitle = message.interactive?.button_reply?.title;
      const listTitle = message.interactive?.list_reply?.title;
      return buttonTitle ?? listTitle ?? null;
    }

    if (message.image?.caption) {
      return message.image.caption;
    }

    if (message.video?.caption) {
      return message.video.caption;
    }

    if (message.document?.filename) {
      return message.document.filename;
    }

    return null;
  }

  private extractMediaUrl(message: MetaIncomingMessage): string | null {
    if (message.type === 'image' && message.image?.link) {
      return message.image.link;
    }

    if (message.type === 'video' && message.video?.link) {
      return message.video.link;
    }

    if (message.type === 'audio' && message.audio?.link) {
      return message.audio.link;
    }

    if (message.type === 'document' && message.document?.link) {
      return message.document.link;
    }

    if (message.sticker?.link) {
      return message.sticker.link;
    }

    return null;
  }

  private async findMessageByPhone(phone: string) {
    const normalized = this.normalizePhoneNumber(phone);
    if (!normalized) {
      return null;
    }

    const variants = new Set<string>([normalized]);

    if (normalized.startsWith('55')) {
      variants.add(normalized.slice(2));
    }

    // Limita a campanhas recentes (últimas 72h) para evitar cross-campaign match
    const recentCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

    return this.prisma.message.findFirst({
      where: {
        createdAt: { gte: recentCutoff },
        OR: Array.from(variants).map((value) => ({
          phoneNumber: {
            endsWith: value,
          },
        })),
      },
      include: {
        campaign: true,
        recipient: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private async findRecipientByPhone(phone: string) {
    const normalized = this.normalizePhoneNumber(phone);
    if (!normalized) {
      return null;
    }

    const variants = new Set<string>([normalized]);

    if (normalized.startsWith('55')) {
      variants.add(normalized.slice(2));
    }

    return this.prisma.campaignRecipient.findFirst({
      where: {
        isActive: true,
        OR: Array.from(variants).map((value) => ({
          phoneNumber: {
            endsWith: value,
          },
        })),
      },
      include: {
        campaign: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private async updateResponseCounters(params: {
    campaignId: string;
    recipient?: any;
    responseTimestamp: Date;
    responseTimeSeconds?: number | null;
  }) {
    const { campaignId, recipient, responseTimestamp, responseTimeSeconds } = params;

    const campaignUpdate: any = {
      responsesCount: { increment: 1 },
      lastResponseAt: responseTimestamp,
    };

    const isFirstResponse = Boolean(recipient?.id) && !recipient.respondedAt;
    const hasResponseTime = this.isFiniteNumber(responseTimeSeconds);

    if (isFirstResponse && hasResponseTime) {
      campaignUpdate.responseTimeTotalSeconds = { increment: responseTimeSeconds };
    }

    if (recipient?.id) {
      const recipientUpdate: any = {
        responseCount: { increment: 1 },
        lastResponseAt: responseTimestamp,
      };

      if (isFirstResponse) {
        recipientUpdate.respondedAt = responseTimestamp;
        campaignUpdate.respondedCount = { increment: 1 };

        if (hasResponseTime) {
          recipientUpdate.firstResponseTimeSeconds = responseTimeSeconds;
        }

        // Engajamento: primeira resposta dentro da janela de 24h após o envio
        const isEngaged =
          hasResponseTime && (responseTimeSeconds as number) <= ENGAGEMENT_WINDOW_SECONDS;

        if (isEngaged) {
          recipientUpdate.engagedAt = responseTimestamp;
          campaignUpdate.engagedCount = { increment: 1 };
          recipient.engagedAt = responseTimestamp;
        }

        recipient.respondedAt = responseTimestamp;
        if (hasResponseTime) {
          recipient.firstResponseTimeSeconds = responseTimeSeconds;
        }
      }

      await this.prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: recipientUpdate,
      });
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: campaignUpdate,
    });
  }

  private calculateResponseTimeSeconds(
    sentAt: Date | null | undefined,
    responseAt: Date,
  ): number | null {
    if (!sentAt) {
      return null;
    }

    const diffSeconds = (responseAt.getTime() - sentAt.getTime()) / 1000;

    if (!Number.isFinite(diffSeconds) || diffSeconds < 0) {
      return null;
    }

    return Number(diffSeconds.toFixed(3));
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private detectOptOut(input: {
    message: MetaIncomingMessage;
    textBody: string | null;
  }): { reason: string } | null {
    const { message, textBody } = input;
    const candidates = new Set<string>();

    if (textBody) {
      candidates.add(textBody);
    }

    if (message.text?.body) {
      candidates.add(message.text.body);
    }

    const interactive = message.interactive;
    if (interactive?.button_reply?.title) {
      candidates.add(interactive.button_reply.title);
    }

    if (interactive?.button_reply?.id) {
      candidates.add(interactive.button_reply.id);
    }

    if (interactive?.list_reply?.title) {
      candidates.add(interactive.list_reply.title);
    }

    if (interactive?.list_reply?.id) {
      candidates.add(interactive.list_reply.id);
    }

    const buttonPayload = (message as any)?.button?.payload;
    if (typeof buttonPayload === 'string') {
      candidates.add(buttonPayload);
    }

    const buttonText = (message as any)?.button?.text;
    if (typeof buttonText === 'string') {
      candidates.add(buttonText);
    }

    for (const candidate of candidates) {
      const normalized = this.normalizeOptOutCandidate(candidate);
      if (!normalized) {
        continue;
      }

      const keyword = this.findOptOutKeyword(normalized);
      if (keyword) {
        return { reason: keyword };
      }
    }

    return null;
  }

  private normalizeOptOutCandidate(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private findOptOutKeyword(normalizedCandidate: string): string | null {
    if (!normalizedCandidate) {
      return null;
    }

    const directMatches = [
      'STOP',
      'CANCEL',
      'CANCELA',
      'CANCELAR',
      'CANCELAMENTO',
      'DESCADASTRAR',
      'DESCADASTRO',
      'REMOVER',
      'REMOVA',
      'PARAR',
      'PARE',
      'SAIR',
      'SAIR DA LISTA',
      'OPT OUT',
      'UNSUBSCRIBE',
      'UNSUB',
      'QUIT',
    ];

    for (const keyword of directMatches) {
      if (normalizedCandidate === keyword) {
        return keyword;
      }

      if (normalizedCandidate.startsWith(`${keyword} `)) {
        return keyword;
      }

      if (normalizedCandidate.endsWith(` ${keyword}`)) {
        return keyword;
      }

      if (normalizedCandidate.includes(` ${keyword} `)) {
        return keyword;
      }
    }

    const containsKeywords = [
      'PARAR DE RECEBER',
      'NAO QUERO RECEBER',
      'NAO QUERO MENSAGENS',
      'NAO ENVIAR',
      'REMOVER DA LISTA',
      'NAO ME MANDAR',
      'NAO RECEBER MAIS',
    ];

    for (const keyword of containsKeywords) {
      if (normalizedCandidate.includes(keyword)) {
        return keyword;
      }
    }

    const compact = normalizedCandidate.replace(/\s+/g, '');
    if (compact === 'OPTOUT') {
      return 'OPT_OUT';
    }

    return null;
  }

  private async handleOptOut(params: {
    campaignId: string;
    recipient: any;
    timestamp: Date;
    reason: string;
  }) {
    const { campaignId, recipient, timestamp, reason } = params;

    if (!recipient?.id) {
      return;
    }

    if (recipient.optedOut) {
      return;
    }

    await this.prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        optedOut: true,
        optedOutAt: timestamp,
        optOutReason: reason,
        isActive: false,
      },
    });

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        optOutCount: { increment: 1 },
      },
    });

    recipient.optedOut = true;
    recipient.optedOutAt = timestamp;
    recipient.optOutReason = reason;
    recipient.isActive = false;

    this.logger.log(
      `🚫 Opt-out detectado (campaign=${campaignId}, recipient=${recipient.id}, reason=${reason})`,
    );
  }
}

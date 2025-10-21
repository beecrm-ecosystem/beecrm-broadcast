import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DiogenesWebhookDto } from './webhook.controller';
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

    // Salva o evento do webhook
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

    // Log apenas em debug
    this.logger.debug(`Webhook salvo: ${webhookEvent.id} - ${whatsappStatus}`);

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
      this.logger.debug(`Mensagem não encontrada: ${messageId} - ${recipientPhone}`);
      // Tenta buscar pelo telefone do destinatário (fallback)
      const messageByPhone = await this.findMessageByPhone(recipientPhone);
      if (messageByPhone) {
        this.logger.log(
          `📨 Webhook de campanha recebido (campaign=${messageByPhone.campaignId}, message=${messageByPhone.id}, status=${whatsappStatus})`,
        );
        await this.updateMessageStatus(messageByPhone, whatsappStatus, status, webhookEvent.id);
      }
      return;
    }

    this.logger.log(
      `📨 Webhook de campanha recebido (campaign=${message.campaignId}, message=${message.id}, status=${whatsappStatus})`,
    );
    await this.updateMessageStatus(message, whatsappStatus, status, webhookEvent.id);
  }

  /**
   * Processa webhook do formato legado Diogenes
   */
  async processDiogenesWebhook(payload: DiogenesWebhookDto) {
    const { event, data } = payload;
    const externalId = data.key.id;

    // Salva o evento do webhook
    await this.prisma.webhookEvent.create({
      data: {
        provider: 'diogenes',
        event,
        payload: payload as any,
      },
    });

    // Busca a mensagem pelo externalId
    const message = await this.prisma.message.findFirst({
      where: { externalId },
      include: {
        campaign: true,
        recipient: true,
      },
    });

    if (!message) {
      this.logger.warn(`Mensagem não encontrada para externalId: ${externalId}`);
      return;
    }

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
   * Atualiza o status da mensagem com base no webhook do Meta
   */
  private async updateMessageStatus(
    message: any,
    whatsappStatus: string,
    statusData: MetaStatusUpdate,
    webhookEventId: string,
  ) {
    const newStatus = this.mapMetaStatusToMessageStatus(whatsappStatus);
    const now = new Date();

    // Log apenas em debug
    this.logger.debug(`Atualiza ${message.id}: ${message.status} → ${newStatus}`);

    // Dados de erro (se houver)
    let errorData: any = null;
    if (statusData.errors && statusData.errors.length > 0) {
      errorData = {
        errorCode: statusData.errors[0].code.toString(),
        errorMessage: statusData.errors[0].title,
        errorDetails: statusData.errors,
      };
    }

    const previousStatus = message.status as MessageStatus | undefined;

    // Atualiza a mensagem
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        status: newStatus,
        whatsappMessageId: statusData.id,
        ...(newStatus === 'SENT' && { sentAt: now }),
        ...(newStatus === 'DELIVERED' && { deliveredAt: now }),
        ...(newStatus === 'READ' && { readAt: now }),
        ...(newStatus === 'FAILED' && {
          failedAt: now,
          ...errorData,
        }),
        metadata: {
          ...message.metadata,
          lastWebhookStatus: whatsappStatus,
          lastWebhookAt: now.toISOString(),
          recipientId: statusData.recipient_id,
        },
      },
    });

    // Atualiza o destinatário
    await this.prisma.campaignRecipient.update({
      where: { id: message.recipientId },
      data: {
        status: newStatus,
        ...(newStatus === 'SENT' && { sentAt: now }),
        ...(newStatus === 'DELIVERED' && { deliveredAt: now }),
        ...(newStatus === 'READ' && { readAt: now }),
      },
    });

    // Atualiza contadores da campanha
    await this.updateCampaignCounters(message.campaignId, newStatus, previousStatus);

    // Marca o webhook como processado
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processed: true,
        processedAt: now,
        messageId: message.id,
      },
    });

    // Log apenas em debug
    this.logger.debug(`✅ ${message.id} → ${newStatus}`);
  }

  /**
   * Busca mensagem pelo telefone do destinatário (mais recente)
   */
  private async findMessageByPhone(phone: string) {
    // Remove o código do país se houver
    const cleanPhone = phone.replace(/^55/, '');

    return this.prisma.message.findFirst({
      where: {
        phoneNumber: {
          contains: cleanPhone,
        },
        status: {
          in: ['PENDING', 'QUEUED', 'SENT'],
        },
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

  /**
   * Mapeia status do Meta para MessageStatus do Prisma
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
   * Atualiza contadores da campanha baseado no novo status
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

    // Decrementa o contador do status anterior (se houver)
    if (previousStatus) {
      switch (previousStatus) {
        case 'SENT':
          updateData.sentCount = { decrement: 1 };
          break;
        case 'DELIVERED':
          updateData.deliveredCount = { decrement: 1 };
          break;
        case 'READ':
          updateData.readCount = { decrement: 1 };
          break;
        case 'FAILED':
          updateData.failedCount = { decrement: 1 };
          break;
      }
    }

    // Incrementa o contador do novo status
    switch (newStatus) {
      case 'SENT':
        updateData.sentCount = { increment: 1 };
        break;
      case 'DELIVERED':
        updateData.deliveredCount = { increment: 1 };
        break;
      case 'READ':
        updateData.readCount = { increment: 1 };
        break;
      case 'FAILED':
        updateData.failedCount = { increment: 1 };
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
}

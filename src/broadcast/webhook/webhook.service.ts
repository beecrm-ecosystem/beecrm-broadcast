import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsAppWebhookDto } from './webhook.controller';
import { MessageStatus } from '@prisma/client';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processa webhook do Diogenes e atualiza status da mensagem
   */
  async processWebhook(payload: WhatsAppWebhookDto) {
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
    await this.updateCampaignCounters(message.campaignId, newStatus);

    this.logger.log(`Mensagem ${message.id} atualizada para status: ${newStatus}`);
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
  private async updateCampaignCounters(campaignId: string, newStatus: MessageStatus) {
    const updateData: any = {};

    switch (newStatus) {
      case 'DELIVERED':
        updateData.deliveredCount = { increment: 1 };
        break;
      case 'READ':
        updateData.readCount = { increment: 1 };
        break;
      case 'FAILED':
        updateData.failedCount = { increment: 1 };
        updateData.sentCount = { decrement: 1 }; // Remove do contador de enviados
        break;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: updateData,
      });
    }
  }
}

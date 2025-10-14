import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { WebhookQueueService } from '../services/webhook-queue.service';

// Formato oficial do Meta WhatsApp Business API
export interface MetaWhatsAppWebhookDto {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
          conversation?: {
            id: string;
            origin: {
              type: string;
            };
          };
          pricing?: {
            billable: boolean;
            pricing_model: string;
            category: string;
            type: string;
          };
          errors?: Array<{
            code: number;
            title: string;
            message?: string;
            error_data?: {
              details: string;
            };
          }>;
        }>;
        messages?: Array<any>;
      };
      field: string;
    }>;
  }>;
}

// Formato legado do Diogenes (manter compatibilidade)
export interface DiogenesWebhookDto {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    status?: string;
    messageTimestamp?: number;
    pushName?: string;
    message?: any;
  };
  destination?: string;
  date_time?: string;
  server_url?: string;
  apikey?: string;
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookQueueService: WebhookQueueService) {}

  /**
   * Recebe webhooks do Meta WhatsApp Business API sobre status das mensagens
   * Formato oficial: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
   *
   * Os webhooks são adicionados a uma fila para processamento assíncrono
   */
  @Post('campaign-status')
  async handleCampaignStatus(@Body() payload: MetaWhatsAppWebhookDto) {
    this.logger.log(`📥 Webhook Meta recebido: ${payload.object}`);

    try {
      const jobIds: string[] = [];

      // Adiciona cada status à fila de processamento
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.value.statuses) {
            // Adiciona cada status à fila
            for (const status of change.value.statuses) {
              this.logger.log(
                `➕ Adicionando à fila - Status: ${status.status} - Message ID: ${status.id} - Recipient: ${status.recipient_id}`,
              );

              const jobId = await this.webhookQueueService.addMetaWebhook(
                status,
                change.value.metadata,
              );

              jobIds.push(jobId);
            }
          }

          if (change.value.messages) {
            // Log de mensagens recebidas (futuro: adicionar à fila também)
            this.logger.log(`💬 Mensagens recebidas: ${change.value.messages.length}`);
          }
        }
      }

      return {
        success: true,
        message: 'Webhooks adicionados à fila para processamento',
        jobIds,
        count: jobIds.length,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao adicionar webhook à fila: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Endpoint legado para compatibilidade com Diogenes
   * Os webhooks são adicionados a uma fila para processamento assíncrono
   */
  @Post('diogenes')
  async handleDiogenesWebhook(@Body() payload: DiogenesWebhookDto) {
    this.logger.log(
      `📥 Webhook Diogenes recebido: ${payload.event} - Message ID: ${payload.data?.key?.id}`,
    );

    try {
      const jobId = await this.webhookQueueService.addDiogenesWebhook(payload);

      return {
        success: true,
        message: 'Webhook adicionado à fila para processamento',
        jobId,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao adicionar webhook à fila: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Obtém estatísticas da fila de webhooks
   */
  @Get('queue/stats')
  async getQueueStats() {
    try {
      const stats = await this.webhookQueueService.getQueueStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      this.logger.error(`Erro ao obter estatísticas da fila: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Endpoint de teste para simular webhooks
   */
  @Post('test')
  testWebhook(@Body() payload: any) {
    this.logger.log('🧪 Webhook de teste recebido');
    return {
      success: true,
      message: 'Webhook de teste recebido (não será processado)',
      payload,
    };
  }
}

import { Controller, Post, Body, Logger } from '@nestjs/common';
import { WebhookService } from './webhook.service';

export interface WhatsAppWebhookDto {
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

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Recebe webhooks do Diogenes sobre status das mensagens
   */
  @Post('diogenes')
  async handleDiogenesWebhook(@Body() payload: WhatsAppWebhookDto) {
    this.logger.log(`Webhook recebido: ${payload.event} - Message ID: ${payload.data?.key?.id}`);

    try {
      await this.webhookService.processWebhook(payload);
      return { success: true, message: 'Webhook processado com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Endpoint de teste para simular webhooks
   */
  @Post('diogenes/test')
  testWebhook(@Body() payload: any) {
    this.logger.log('Webhook de teste recebido');
    return {
      success: true,
      message: 'Webhook de teste recebido',
      payload,
    };
  }
}

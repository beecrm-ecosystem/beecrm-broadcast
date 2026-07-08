import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WebhookQueueService } from '../services/webhook-queue.service';
import { RcsWebhookDto } from './rcs-webhook.dto';
import { Public } from '../auth/public.decorator';

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

@ApiTags('Webhooks')
@Public() // webhooks de provider (Meta/Pontaltech) — autenticação própria é card separado
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
  @ApiOperation({ summary: 'Recebe webhooks do Meta WhatsApp Business API' })
  @ApiBody({
    required: true,
    description: 'Payload enviado pelo Meta WhatsApp Business API',
    schema: {
      type: 'object',
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processado e adicionado à fila',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        jobIds: { type: 'array', items: { type: 'string' } },
        count: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Erro ao processar webhook',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' }, error: { type: 'string' } },
    },
  })
  async handleCampaignStatus(@Body() payload: MetaWhatsAppWebhookDto) {
    // Log resumido no terminal
    this.logger.debug(`📥 Webhook Meta recebido: ${payload.object}`);

    try {
      const jobIds: string[] = [];

      // Adiciona cada status à fila de processamento
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.value.statuses) {
            // Adiciona cada status à fila
            for (const status of change.value.statuses) {
              // Log apenas em debug (não aparece em produção)
              this.logger.debug(`➕ Fila - ${status.status} - ${status.recipient_id}`);

              const jobId = await this.webhookQueueService.addMetaWebhook(
                status,
                change.value.metadata,
              );

              jobIds.push(jobId);
            }
          }

          if (change.value.messages) {
            for (const message of change.value.messages) {
              this.logger.debug(
                `➕ Fila - mensagem recebida ${message.id} - ${message.from ?? 'unknown'}`,
              );

              const jobId = await this.webhookQueueService.addMetaMessage(
                message,
                change.value.metadata,
              );

              jobIds.push(jobId);
            }
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
  @ApiOperation({ summary: 'Recebe webhooks no formato legado Diogenes' })
  @ApiBody({
    required: true,
    description: 'Payload legado do Diogenes',
    schema: {
      type: 'object',
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook legado adicionado à fila',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        jobId: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Erro ao adicionar webhook legado',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' }, error: { type: 'string' } },
    },
  })
  async handleDiogenesWebhook(@Body() payload: DiogenesWebhookDto) {
    this.logger.debug(`📥 Webhook Diogenes: ${payload.event}`);

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
   * Recebe webhooks de status RCS da Pontaltech
   * Os webhooks são adicionados a uma fila para processamento assíncrono
   */
  @Post('rcs')
  @ApiOperation({ summary: 'Recebe webhooks de status RCS da Pontaltech' })
  @ApiBody({
    required: true,
    description: 'Payload de callback enviado pela Pontaltech (status update RCS)',
    schema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'ID da mensagem na Pontaltech' },
        status: { type: 'string', description: 'Status: DELIVERED, READ, FAILED, etc.' },
        phone: { type: 'string', description: 'Telefone do destinatario' },
        timestamp: { type: 'string', description: 'Timestamp do evento' },
        errorCode: { type: 'string', description: 'Codigo de erro (se houver)' },
        errorMessage: { type: 'string', description: 'Mensagem de erro (se houver)' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook RCS adicionado a fila',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        jobId: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Erro ao adicionar webhook RCS',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' }, error: { type: 'string' } },
    },
  })
  async handleRcsWebhook(@Body() payload: RcsWebhookDto) {
    this.logger.debug(
      `Webhook RCS recebido: messageId=${payload.messageId}, status=${payload.status}`,
    );

    try {
      const jobId = await this.webhookQueueService.addRcsWebhook(payload);

      return {
        success: true,
        message: 'Webhook RCS adicionado a fila para processamento',
        jobId,
      };
    } catch (error) {
      this.logger.error(`Erro ao adicionar webhook RCS a fila: ${error.message}`);
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
  @ApiOperation({ summary: 'Obtém métricas da fila de processamento de webhooks' })
  @ApiResponse({
    status: 200,
    description: 'Estatísticas retornadas com sucesso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        stats: { type: 'object' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Erro ao obter estatísticas',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' }, error: { type: 'string' } },
    },
  })
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
  @ApiOperation({ summary: 'Recebe um payload de teste para validação' })
  @ApiBody({
    required: true,
    description: 'Payload arbitrário para simular webhooks',
    schema: {
      type: 'object',
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook de teste recebido',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        payload: { type: 'object' },
      },
    },
  })
  testWebhook(@Body() payload: any) {
    this.logger.log('🧪 Webhook de teste recebido');
    return {
      success: true,
      message: 'Webhook de teste recebido (não será processado)',
      payload,
    };
  }
}

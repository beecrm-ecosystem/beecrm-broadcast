import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhookService } from '../webhook/webhook.service';
import { FileLoggerService } from '../services/file-logger.service';

export interface MetaWebhookJob {
  type: 'meta';
  status: {
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
  };
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
}

export interface DiogenesWebhookJob {
  type: 'diogenes';
  payload: {
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
  };
}

export type WebhookJob = MetaWebhookJob | DiogenesWebhookJob;

@Processor('webhook-queue', {
  concurrency: 5, // Processa até 5 webhooks simultaneamente
  limiter: {
    max: 50, // Máximo de 50 jobs
    duration: 1000, // Por segundo
  },
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly fileLogger: FileLoggerService,
  ) {
    super();
  }

  async process(job: Job<WebhookJob>): Promise<any> {
    const jobData = job.data;

    try {
      if (jobData.type === 'meta') {
        // Log em arquivo ao invés do terminal
        this.fileLogger.logWebhook({
          timestamp: new Date().toISOString(),
          type: 'meta',
          messageId: jobData.status.id,
          status: jobData.status.status,
          recipient: jobData.status.recipient_id,
          metadata: jobData.metadata,
          payload: jobData.status,
        });

        await this.webhookService.processMetaWebhook(jobData.status, jobData.metadata);

        // Apenas log de sucesso resumido no terminal
        this.logger.debug(
          `✅ Webhook processado - ${jobData.status.status} - ${jobData.status.recipient_id}`,
        );

        return {
          success: true,
          type: 'meta',
          messageId: jobData.status.id,
          status: jobData.status.status,
        };
      } else if (jobData.type === 'diogenes') {
        // Log em arquivo ao invés do terminal
        this.fileLogger.logWebhook({
          timestamp: new Date().toISOString(),
          type: 'diogenes',
          messageId: jobData.payload.data?.key?.id || 'unknown',
          status: jobData.payload.event,
          recipient: jobData.payload.data?.key?.remoteJid || 'unknown',
          payload: jobData.payload,
        });

        await this.webhookService.processDiogenesWebhook(jobData.payload);

        this.logger.debug(`✅ Webhook Diogenes processado - ${jobData.payload.event}`);

        return {
          success: true,
          type: 'diogenes',
          event: jobData.payload.event,
        };
      }

      throw new Error(`Tipo de webhook desconhecido: ${(jobData as any).type}`);
    } catch (error) {
      this.logger.error(
        `❌ Erro ao processar webhook - Job ID: ${job.id} - Erro: ${error.message}`,
        error.stack,
      );

      // Verifica se é um erro que vale a pena fazer retry
      const shouldRetry = this.shouldRetryJob(error, job);

      if (!shouldRetry) {
        this.logger.warn(`⚠️ Job ${job.id} não será reprocessado (erro permanente)`);
        // Retorna sucesso para o BullMQ não tentar novamente
        return {
          success: false,
          error: error.message,
          permanent: true,
        };
      }

      // Para erros temporários, lança exceção para o BullMQ fazer retry
      throw error;
    }
  }

  /**
   * Determina se o job deve ser reprocessado
   */
  private shouldRetryJob(error: any, job: Job): boolean {
    // Não faz retry se já tentou muitas vezes
    if (job.attemptsMade >= 3) {
      return false;
    }

    // Não faz retry para erros de validação ou dados inválidos
    if (error.message?.includes('não encontrada') || error.message?.includes('inválido')) {
      return false;
    }

    // Faz retry para erros de conexão, timeout, etc
    return true;
  }

  /**
   * Callback chamado quando o job falha após todos os retries
   */
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `🔴 Job ${job.id} falhou definitivamente após ${job.attemptsMade} tentativas`,
    );
    this.logger.error(`Erro: ${error.message}`);
    this.logger.debug(`Job data:`, JSON.stringify(job.data, null, 2));
  }

  /**
   * Callback chamado quando o job é completado
   */
  onCompleted(job: Job, result: any) {
    if (result.success) {
      this.logger.debug(`✨ Job ${job.id} completado com sucesso`);
    } else {
      this.logger.warn(`⚠️ Job ${job.id} completado com falha permanente`);
    }
  }

  /**
   * Callback chamado quando o job está atrasado (stalled)
   */
  onStalled(jobId: string) {
    this.logger.warn(`⏸️ Job ${jobId} está travado (stalled) - será reprocessado`);
  }
}

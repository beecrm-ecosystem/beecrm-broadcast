import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MetaWebhookJob,
  DiogenesWebhookJob,
  MetaMessageWebhookJob,
} from '../queues/webhook.processor';

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    @InjectQueue('webhook-queue')
    private readonly webhookQueue: Queue,
  ) {}

  /**
   * Adiciona webhook do Meta à fila
   */
  async addMetaWebhook(
    status: MetaWebhookJob['status'],
    metadata: MetaWebhookJob['metadata'],
  ): Promise<string> {
    const job = await this.webhookQueue.add(
      'process-meta-webhook',
      {
        type: 'meta',
        status,
        metadata,
      } as MetaWebhookJob,
      {
        attempts: 3, // Tenta 3 vezes em caso de falha
        backoff: {
          type: 'exponential',
          delay: 2000, // Começa com 2s, depois 4s, depois 8s
        },
        removeOnComplete: 100, // Mantém apenas os últimos 100 jobs completados
        removeOnFail: 500, // Mantém apenas os últimos 500 jobs falhos
      },
    );

    // Log apenas em debug
    this.logger.debug(`📤 Webhook Meta na fila - Job: ${job.id} - Msg: ${status.id}`);

    return job.id || '';
  }

  /**
   * Adiciona webhook do Diogenes à fila
   */
  async addDiogenesWebhook(payload: DiogenesWebhookJob['payload']): Promise<string> {
    const job = await this.webhookQueue.add(
      'process-diogenes-webhook',
      {
        type: 'diogenes',
        payload,
      } as DiogenesWebhookJob,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Log apenas em debug
    this.logger.debug(`📤 Webhook Diogenes na fila - Job: ${job.id} - Event: ${payload.event}`);

    return job.id || '';
  }

  /**
   * Adiciona mensagens recebidas do Meta à fila
   */
  async addMetaMessage(
    message: MetaMessageWebhookJob['message'],
    metadata: MetaMessageWebhookJob['metadata'],
  ): Promise<string> {
    const job = await this.webhookQueue.add(
      'process-meta-message',
      {
        type: 'meta-message',
        message,
        metadata,
      } as MetaMessageWebhookJob,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    this.logger.debug(
      `📤 Mensagem Meta na fila - Job: ${job.id} - From: ${message?.from ?? 'unknown'}`,
    );

    return job.id || '';
  }

  /**
   * Obtém estatísticas da fila
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.webhookQueue.getWaitingCount(),
      this.webhookQueue.getActiveCount(),
      this.webhookQueue.getCompletedCount(),
      this.webhookQueue.getFailedCount(),
      this.webhookQueue.getDelayedCount(),
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
   * Limpa jobs antigos
   */
  async cleanQueue(gracePeriod: number = 3600000) {
    // 1 hora em ms
    const cleaned = await this.webhookQueue.clean(gracePeriod, 1000, 'completed');
    this.logger.log(`🧹 Fila limpa: ${cleaned.length} jobs removidos`);
    return cleaned.length;
  }

  /**
   * Pausa a fila
   */
  async pauseQueue() {
    await this.webhookQueue.pause();
    this.logger.warn('⏸️ Fila de webhooks pausada');
  }

  /**
   * Resume a fila
   */
  async resumeQueue() {
    await this.webhookQueue.resume();
    this.logger.log('▶️ Fila de webhooks retomada');
  }

  /**
   * Obtém jobs falhos para inspeção
   */
  async getFailedJobs(limit: number = 10) {
    return this.webhookQueue.getFailed(0, limit);
  }

  /**
   * Reprocessa um job falho
   */
  async retryFailedJob(jobId: string) {
    const job = await this.webhookQueue.getJob(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} não encontrado`);
    }

    await job.retry();
    this.logger.log(`🔄 Job ${jobId} adicionado para reprocessamento`);
  }

  /**
   * Obtém detalhes de um job específico
   */
  async getJobDetails(jobId: string) {
    const job = await this.webhookQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: await job.getState(),
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
    };
  }
}

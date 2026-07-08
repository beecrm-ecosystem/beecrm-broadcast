import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

interface DeadLetterJob {
  campaignId?: string;
  recipientId?: string;
  phoneNumber?: string;
  error?: string;
  errorCode?: number | string;
  attempts?: number;
  permanent?: boolean;
  timestamp?: string;
}

/**
 * Consumer da dead-letter queue.
 *
 * Antes o `broadcast-dlq` tinha produtor (pushToDlq no BroadcastProcessor) mas
 * nenhum `@Processor` — os jobs mortos acumulavam em 'waiting' indefinidamente
 * (removeOnComplete/removeOnFail nunca disparavam) e o worker.ts ainda anunciava
 * um "DLQ listener" que não existia.
 *
 * Este consumer dá visibilidade (log de erro estruturado, telefone mascarado) e
 * deixa o job completar, para o `removeOnComplete` (age 24h) limpar. Reprocesso
 * manual continua via `scripts/requeue-campaign.js`.
 */
@Processor('broadcast-dlq')
export class DlqProcessor extends WorkerHost {
  private readonly logger = new Logger(DlqProcessor.name);

  async process(job: Job<DeadLetterJob>): Promise<{ acknowledged: boolean }> {
    const d = job.data || {};
    this.logger.error(
      `☠️ DLQ: mensagem morta campaign=${d.campaignId ?? '-'} recipient=${d.recipientId ?? '-'} ` +
        `phone=${this.maskPhone(d.phoneNumber)} attempts=${d.attempts ?? '-'} permanent=${d.permanent ?? '-'} ` +
        `errorCode=${d.errorCode ?? '-'} error=${d.error ?? '-'}`,
    );
    return { acknowledged: true };
  }

  private maskPhone(value?: string): string {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length < 6) {
      return '***';
    }
    return digits.slice(0, 2) + '*'.repeat(digits.length - 6) + digits.slice(-4);
  }
}

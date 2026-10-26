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

  /**
   * Chave de deduplicacao do job de envio (BC-01): um destinatario tem no
   * maximo um job vivo (waiting/delayed/active) na fila. Enfileirar de novo
   * enquanto ele existe (requeue concorrente, monitor + start) vira no-op no
   * BullMQ. A chave some quando o job termina (completed/failed) ou e removido,
   * entao o requeue de quem ficou preso continua funcionando — o que um jobId
   * fixo impediria por ate 24h (removeOnFail mantem o job falho com o mesmo id).
   */
  static sendDeduplicationId(campaignId: string, recipientId: string): string {
    return `send-${campaignId}-${recipientId}`;
  }

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

    // Distribuição uniforme: calcula delay individual por mensagem
    const timeWindows = (campaign.timeWindows as any[]) || [];
    if (campaign.distributeEvenly && timeWindows.length > 0) {
      return this.enqueueDistributeEvenly(campaign, recipients, recipientIdsToQueue);
    }

    const campaignTemplateData = campaign.templateData as any;
    const batchSize = Math.max(1, campaign.batchSize || 1);
    const delayBetweenBatches = Math.max(0, campaign.delayBetweenBatches ?? 0);

    // Adiciona cada destinatário na fila com delay progressivo
    const jobs = recipients.map((recipient, index) => {
      const batchNumber = Math.floor(index / batchSize);
      const delay = batchNumber * delayBetweenBatches;

      // Per-recipient template override (used by rotation campaigns)
      const recipientMeta = recipient.metadata as Record<string, any> | null;
      const templateOverride = recipientMeta?.templateOverride ?? null;
      const templateData = templateOverride || campaignTemplateData;

      // Salva templateInfo no metadata do recipient para rastreamento
      const templateInfo = {
        name: templateData.name || campaign.templateId,
        category: templateData.category
          || (campaignTemplateData as any).category
          || this.findCategoryFromTimeWindows(campaign, templateData.name)
          || null,
      };
      this.saveTemplateInfo(recipient.id, recipientMeta, templateInfo);

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
          deduplication: { id: QueueService.sendDeduplicationId(campaign.id, recipient.id) },
          attempts: 3, // 1 tentativa + 2 retries curtos
          backoff: {
            type: 'exponential',
            delay: 1000, // 1s, depois 2s, 4s
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
      batchSize,
      delayBetweenBatches,
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

    const paused = await this.broadcastQueue.isPaused();

    // Coleta latência média aproximada (se disponível) usando timestamps de job
    const jobs = await this.broadcastQueue.getJobs(['active', 'waiting', 'delayed'], 0, 50);
    const now = Date.now();
    const latencies = jobs
      .map((job) =>
        (job.processedOn ?? job.timestamp) ? now - (job.processedOn ?? job.timestamp) : 0,
      )
      .filter((v) => v > 0);
    const avgLatencyMs = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
      avgLatencyMs,
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

  /**
   * Enfileira destinatários com distribuição uniforme na janela de envio.
   * Calcula o delay individual entre mensagens para espalhar uniformemente
   * dentro da janela (ex: 09:00-19:00). Respeita o teto do tier do canal.
   * Destinatários que excedem a capacidade da janela ficam PENDING para
   * serem enfileirados no próximo dia pelo monitor.
   */
  private async enqueueDistributeEvenly(
    campaign: any,
    recipients: any[],
    recipientIdsToQueue: string[],
  ) {
    const timeWindows = (campaign.timeWindows as any[]) || [];
    const window = timeWindows[0];
    const tz = window.timezone || 'America/Sao_Paulo';

    // Parse janela de envio
    const [startH, startM] = window.startTime.split(':').map(Number);
    const [endH, endM] = window.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const windowMinutes =
      endMinutes > startMinutes ? endMinutes - startMinutes : 24 * 60 - startMinutes + endMinutes; // overnight

    // Calcular ritmo necessário (msg/min)
    let ratePerMinute = recipients.length / windowMinutes;
    const tierCap = campaign.tierRatePerMinute;

    let recipientsToEnqueue = recipients;
    let overflowCount = 0;

    // Se excede o tier, limita e calcula overflow
    if (tierCap && ratePerMinute > tierCap) {
      ratePerMinute = tierCap;
      const maxPerWindow = Math.floor(tierCap * windowMinutes);

      if (maxPerWindow < recipients.length) {
        overflowCount = recipients.length - maxPerWindow;
        recipientsToEnqueue = recipients.slice(0, maxPerWindow);

        // Reverte overflow para PENDING (não serão enfileirados agora)
        const overflowIds = recipients.slice(maxPerWindow).map((r) => r.id);
        await this.prisma.campaignRecipient.updateMany({
          where: { id: { in: overflowIds } },
          data: { status: MessageStatus.PENDING },
        });

        this.logger.warn(
          `📊 Distribute evenly: ${overflowCount} destinatários excederam a capacidade da janela ` +
            `(max ${maxPerWindow} com tier ${tierCap} msg/min × ${windowMinutes}min). ` +
            `Serão reagendados no próximo dia.`,
        );
      }
    }

    // Garantir mínimo 1 msg/min
    ratePerMinute = Math.max(ratePerMinute, 1 / 60); // pelo menos 1 msg/hora
    const delayBetweenMessagesMs = Math.round(60000 / ratePerMinute);

    // Calcular offset inicial: se estamos antes da janela, atrasar até o startTime
    const now = new Date();
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();

    let initialOffsetMs = 0;
    const isOvernight = endMinutes <= startMinutes;

    if (isOvernight) {
      // Janela overnight (ex: 22:00-06:00)
      const isInside = currentMinutes >= startMinutes || currentMinutes < endMinutes;
      if (!isInside) {
        if (currentMinutes < startMinutes) {
          initialOffsetMs = (startMinutes - currentMinutes) * 60000;
        } else {
          initialOffsetMs = (24 * 60 - currentMinutes + startMinutes) * 60000;
        }
      }
    } else {
      // Janela normal
      if (currentMinutes < startMinutes) {
        initialOffsetMs = (startMinutes - currentMinutes) * 60000;
      } else if (currentMinutes >= endMinutes) {
        // Passou da janela de hoje — offset para amanhã no startTime
        initialOffsetMs = (24 * 60 - currentMinutes + startMinutes) * 60000;
      }
    }

    this.logger.log(
      `📊 Distribute evenly: ${recipientsToEnqueue.length} msgs na janela ` +
        `${window.startTime}-${window.endTime} (${windowMinutes}min), ` +
        `ritmo=${ratePerMinute.toFixed(2)} msg/min, ` +
        `delay entre msgs=${Math.round(delayBetweenMessagesMs / 1000)}s, ` +
        `offset inicial=${Math.round(initialOffsetMs / 60000)}min` +
        (tierCap ? `, tier cap=${tierCap} msg/min` : '') +
        (overflowCount > 0 ? `, overflow=${overflowCount}` : ''),
    );

    const campaignTemplateData = campaign.templateData;

    const jobs = recipientsToEnqueue.map((recipient, index) => {
      const delay = initialOffsetMs + index * delayBetweenMessagesMs;

      const recipientMeta = recipient.metadata as Record<string, any> | null;
      const templateOverride = recipientMeta?.templateOverride ?? null;
      const templateData = templateOverride || campaignTemplateData;

      // Salva templateInfo no metadata do recipient para rastreamento
      const templateInfo = {
        name: templateData.name || campaign.templateId,
        category: templateData.category
          || (campaignTemplateData as any).category
          || this.findCategoryFromTimeWindows(campaign, templateData.name)
          || null,
      };
      this.saveTemplateInfo(recipient.id, recipientMeta, templateInfo);

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
          deduplication: { id: QueueService.sendDeduplicationId(campaign.id, recipient.id) },
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 1000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      };
    });

    try {
      await this.broadcastQueue.addBulk(jobs);
    } catch (error) {
      // Reverte todos para PENDING se falhar
      await this.prisma.campaignRecipient.updateMany({
        where: { id: { in: recipientIdsToQueue } },
        data: { status: MessageStatus.PENDING },
      });
      throw error;
    }

    this.logger.log(
      `✅ ${jobs.length} mensagens enfileiradas (distribuição uniforme). ` +
        (overflowCount > 0 ? `${overflowCount} pendentes para próximo dia.` : ''),
    );

    return {
      totalEnqueued: jobs.length,
      overflow: overflowCount,
      ratePerMinute: Math.round(ratePerMinute * 100) / 100,
      delayBetweenMessagesMs,
      windowMinutes,
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

  /**
   * Busca a category do template nos timeWindows da campanha
   */
  private findCategoryFromTimeWindows(campaign: any, templateName: string): string | null {
    const timeWindows = (campaign.timeWindows as any[]) || [];
    if (!timeWindows.length || !templateName) return null;
    const match = timeWindows.find((w: any) => w.templateName === templateName);
    return match?.category || timeWindows[0]?.category || null;
  }

  /**
   * Salva templateInfo no metadata do recipient (fire-and-forget)
   */
  private saveTemplateInfo(
    recipientId: string,
    currentMeta: Record<string, any> | null,
    templateInfo: { name: string; category: string | null },
  ) {
    const merged = { ...(currentMeta || {}), templateInfo };
    this.prisma.campaignRecipient
      .update({
        where: { id: recipientId },
        data: { metadata: merged },
      })
      .catch((err) => {
        this.logger.warn(`Falha ao salvar templateInfo do recipient ${recipientId}: ${err.message}`);
      });
  }
}

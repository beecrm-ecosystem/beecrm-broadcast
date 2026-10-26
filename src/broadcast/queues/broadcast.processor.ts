import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ChannelDispatcherFactory } from '../services/channel-dispatcher.factory';
import {
  CampaignWebhookService,
  BroadcastMessageSummary,
  MessageResultItem,
} from '../services/campaign-webhook.service';
import { Queue } from 'bullmq';
import { isMetaApiError, MetaApiError } from '../services/meta-error';
import { QueueService } from '../services/queue.service';

export interface SendMessageJob {
  campaignId: string;
  recipientId: string;
  recipientPhone: string;
  recipientName: string;
  recipientVariables: Record<string, any>;
  templateData: any;
  channel: string;
  templateName: string;
  templateLanguage: string;
}

interface DeadLetterJob {
  campaignId: string;
  recipientId: string;
  phoneNumber: string;
  error: string;
  errorCode?: number | string;
  attempts: number;
  permanent: boolean;
  timestamp: string;
}

@Processor('broadcast-queue', { concurrency: 100 })
export class BroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(BroadcastProcessor.name);
  // Cache para controlar envio de webhooks de progresso
  private readonly progressCache = new Map<string, { lastSent: number; lastCount: number }>();
  // Envia webhook a cada X mensagens ou Y segundos
  private readonly PROGRESS_THRESHOLD = 10; // Mensagens
  private readonly PROGRESS_INTERVAL = 30000; // 30 segundos
  // Buffer para reduzir writes síncronos de contadores
  private readonly counterBuffer = new Map<
    string,
    { sentDelta: number; failedDelta: number; lastFlush: number; flushPromise?: Promise<void> }
  >();
  // Buffer para agrupar resultados de mensagens antes de enviar webhook
  private readonly messageResultsBuffer = new Map<
    string,
    { items: MessageResultItem[]; firstBuffered: number }
  >();

  // Garante que só uma rotina de pause+resume está agendada por vez,
  // mesmo que vários jobs em paralelo recebam BACKPRESSURE simultaneamente.
  private backpressureUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcherFactory: ChannelDispatcherFactory,
    private readonly campaignWebhookService: CampaignWebhookService,
    @InjectQueue('broadcast-dlq') private readonly dlq: Queue<DeadLetterJob>,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<SendMessageJob>): Promise<any> {
    const {
      campaignId,
      recipientId,
      recipientPhone,
      recipientName,
      recipientVariables,
      templateData,
      channel,
      templateName,
      templateLanguage,
    } = job.data;

    // Guard de status: pause/cancel mudam só o status no banco e não drenam a
    // fila, então checamos a campanha antes de enviar. CANCELED/COMPLETED/FAILED
    // → descarta o job (não envia). PAUSED → re-atrasa (mantém o job vivo para
    // quando a campanha for retomada). Sem isso, jobs já enfileirados continuam
    // disparando após pausar/cancelar.
    const campaignState = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (
      !campaignState ||
      ['CANCELED', 'COMPLETED', 'FAILED'].includes(campaignState.status)
    ) {
      this.logger.log(
        `⏭️ Campanha ${campaignId} em ${campaignState?.status ?? 'inexistente'} — job descartado (sem envio)`,
      );
      return { success: false, reason: 'campaign_not_active', skipped: true };
    }
    if (campaignState.status === 'PAUSED') {
      const delayMs = 60000; // re-checa em 1min; retoma sozinho quando voltar a PROCESSING
      this.logger.log(`⏸️ Campanha ${campaignId} pausada — reagendando job em ${delayMs / 1000}s`);
      await job.moveToDelayed(Date.now() + delayMs);
      return { success: false, reason: 'campaign_paused', rescheduled: true };
    }

    // Verificar time window antes de processar
    const timeWindowCheck = await this.checkTimeWindow(
      campaignId,
      templateData?.name || templateName,
    );
    if (timeWindowCheck.outsideWindow) {
      this.logger.log(
        `⏰ Fora da janela ${timeWindowCheck.window?.startTime}-${timeWindowCheck.window?.endTime}. ` +
          `Reagendando em ${Math.round((timeWindowCheck.delayMs || 0) / 60000)}min`,
      );
      await job.moveToDelayed(Date.now() + (timeWindowCheck.delayMs || 60000));
      return { success: false, reason: 'outside_time_window', rescheduled: true };
    }

    this.logger.log(
      `Processando envio para ${recipientName} (${recipientPhone}) - Campanha: ${campaignId}`,
    );

    try {
      // Obtém o dispatcher adequado para o canal
      const dispatcher = this.dispatcherFactory.getDispatcher(channel);

      // Envia via dispatcher (WhatsApp → Diogenes, RCS → Pontaltech)
      const result = await dispatcher.sendMessage(job.data);

      // Salva a mensagem no banco com o ID retornado
      const message = await this.prisma.message.create({
        data: {
          campaignId,
          recipientId,
          templateId: templateData.id || templateName,
          externalId: result.externalId,
          phoneNumber: recipientPhone,
          status: 'SENT',
          sentAt: new Date(),
          metadata: result.metadata || {},
        },
      });

      // Atualiza o status do destinatário
      await this.prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      // Atualiza contadores da campanha com buffer (reduz writes)
      await this.bufferCounters(campaignId, { sentDelta: 1 });

      // Bufferiza resultado da mensagem para webhook em lote
      await this.bufferMessageResult(campaignId, {
        phoneNumber: recipientPhone,
        name: recipientName,
        externalId: result.externalId ?? null,
        status: 'SENT',
        sentAt: new Date().toISOString(),
        errorMessage: null,
        errorCode: null,
      });

      // Envia webhook de progresso (throttled)
      const updatedCampaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (updatedCampaign) {
        await this.sendProgressWebhook(updatedCampaign);
      }

      // Verifica se todos os destinatários foram processados
      await this.checkAndCompleteCampaign(campaignId);

      this.logger.log(
        `Mensagem enviada com sucesso! ID: ${message.id} | External ID: ${result.externalId}`,
      );

      return {
        success: true,
        messageId: message.id,
        externalId: result.externalId,
      };
    } catch (error) {
      this.logger.error(`Erro ao processar envio para ${recipientPhone}: ${error.message}`);

      // Rate limit da Meta (BACKPRESSURE) ou circuit breaker aberto:
      // não persiste falha no BD, pausa a fila por alguns segundos e
      // relança para o BullMQ retentar quando voltar.
      const msg = typeof error.message === 'string' ? error.message : '';
      if (msg.startsWith('BACKPRESSURE:') || msg.startsWith('Circuit breaker aberto')) {
        await this.applyBackpressure();
        throw error;
      }

      const metaError = isMetaApiError(error) ? (error as MetaApiError) : null;

      // Permanente: HTTP 4xx específico OU código Meta classificado como permanente.
      const isPermanentByHttp =
        error.response?.status && [400, 401, 403, 404, 422].includes(error.response.status);
      const isPermanentByMeta = metaError?.policy === 'permanent';
      const isPermanentError = Boolean(isPermanentByHttp || isPermanentByMeta);

      if (isPermanentError) {
        const reason = metaError
          ? `Meta #${metaError.metaCode}`
          : `HTTP ${error.response.status}`;
        this.logger.error(`Erro permanente (${reason}) - não será feito retry`);
      }

      const httpStatusCode =
        metaError?.httpStatusCode ?? error.response?.status ?? 'UNKNOWN';
      const errorCode = metaError ? String(metaError.metaCode) : String(httpStatusCode);
      const errorMessage = metaError?.metaMessage ?? error.message;
      // Codigo que viaja no messageResults: o CRM so reconhece string de
      // digitos (ctype_digit), entao o 'UNKNOWN' de falha sem HTTP vira null.
      const resultErrorCode = /^\d+$/.test(errorCode) ? errorCode : null;

      const failureMetadata: Record<string, any> = {
        httpStatusCode,
      };
      if (metaError) {
        failureMetadata.metaCode = metaError.metaCode;
        failureMetadata.metaMessage = metaError.metaMessage;
        failureMetadata.metaDetails = metaError.metaDetails;
        failureMetadata.metaPolicy = metaError.policy;
        failureMetadata.fbtraceId = metaError.fbtraceId;
      }

      // Cria registro de mensagem com o erro
      await this.prisma.message.create({
        data: {
          campaignId,
          recipientId,
          templateId: templateData.id || templateName,
          phoneNumber: recipientPhone,
          status: 'FAILED',
          failedAt: new Date(),
          errorCode,
          errorMessage,
          metadata: failureMetadata,
        },
      });

      // Marca como falha no banco
      await this.prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'FAILED',
          metadata: {
            ...failureMetadata,
            error: errorMessage,
            errorCode,
            failedAt: new Date(),
            attemptNumber: job.attemptsMade,
          },
        },
      });

      const attempts = job.opts.attempts ?? 1;
      const isLastAttempt = job.attemptsMade + 1 >= attempts;

      // Só incrementa failedCount na última tentativa ou erro permanente
      // para evitar double-counting em retries do BullMQ
      if (isPermanentError || isLastAttempt) {
        await this.bufferCounters(campaignId, { failedDelta: 1 });

        await this.bufferMessageResult(campaignId, {
          phoneNumber: recipientPhone,
          name: recipientName,
          externalId: null,
          status: 'FAILED',
          sentAt: null,
          errorMessage,
          errorCode: resultErrorCode,
        });
      }

      // Envia webhook de progresso (throttled)
      const updatedCampaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (updatedCampaign) {
        await this.sendProgressWebhook(updatedCampaign);
      }

      // Verifica se todos os destinatários foram processados
      await this.checkAndCompleteCampaign(campaignId);

      if (isPermanentError || isLastAttempt) {
        this.logger.warn(
          `Job marcado como concluído (${isPermanentError ? 'falha permanente' : 'última tentativa esgotada'})`,
        );

        await this.pushToDlq({
          campaignId,
          recipientId,
          phoneNumber: recipientPhone,
          error: errorMessage,
          errorCode,
          attempts: job.attemptsMade + 1,
          permanent: isPermanentError,
        });

        return {
          success: false,
          error: errorMessage,
          permanent: isPermanentError,
        };
      }

      // Para erros temporários (500, timeout, etc), faz retry
      throw error;
    }
  }

  /**
   * Envia webhook de progresso (com throttling para não sobrecarregar)
   */
  private async sendProgressWebhook(campaign: any): Promise<void> {
    try {
      const now = Date.now();
      const cached = this.progressCache.get(campaign.id);
      const processedCount = campaign.sentCount + campaign.failedCount;
      const isComplete = processedCount >= campaign.totalRecipients;

      // Se a campanha está completa, não envia aqui (será enviado no checkAndCompleteCampaign)
      if (isComplete) {
        this.logger.debug(
          `⏭️ Campanha ${campaign.id} completa, webhook será enviado na finalização`,
        );
        return;
      }

      // Não envia webhook se:
      // 1. Já enviou recentemente (< 30s) E
      // 2. A diferença de mensagens processadas é pequena (< 10)
      if (cached) {
        const timeSinceLastSent = now - cached.lastSent;
        const countDifference = processedCount - cached.lastCount;

        if (
          timeSinceLastSent < this.PROGRESS_INTERVAL &&
          countDifference < this.PROGRESS_THRESHOLD
        ) {
          this.logger.debug(
            `⏸️ Throttling webhook: tempo=${timeSinceLastSent}ms, diff=${countDifference}`,
          );
          return;
        }
      }

      // Atualiza cache
      this.progressCache.set(campaign.id, {
        lastSent: now,
        lastCount: processedCount,
      });

      // Envia webhook com métricas atualizadas
      await this.campaignWebhookService.sendBroadcastSummary(campaign, {
        status: campaign.status,
        totalContacts: campaign.totalRecipients,
        failedContacts: campaign.failedCount,
      });

      this.logger.debug(
        `📊 Webhook de progresso enviado: ${campaign.id} (${processedCount}/${campaign.totalRecipients})`,
      );
    } catch (error) {
      this.logger.error(`Erro ao enviar webhook de progresso: ${error.message}`);
    }
  }

  /**
   * Verifica se todos os destinatários foram processados e completa a campanha
   */
  private async checkAndCompleteCampaign(campaignId: string) {
    // Garante flush de contadores pendentes antes de checar conclusão
    await this.flushCounters(campaignId, true);
    // Garante flush de resultados de mensagens pendentes antes de checar conclusão
    await this.flushMessageResults(campaignId, true);

    this.logger.debug(`🔍 Verificando conclusão da campanha ${campaignId}`);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || campaign.status !== 'PROCESSING') {
      this.logger.debug(
        `⏭️ Campanha ${campaignId} não está em processamento (status=${campaign?.status ?? 'NOT_FOUND'})`,
      );
      return;
    }

    const processedCount = campaign.sentCount + campaign.failedCount;
    this.logger.debug(
      `📊 Campanha ${campaignId}: processados=${processedCount}, total=${campaign.totalRecipients} (sent=${campaign.sentCount}, failed=${campaign.failedCount})`,
    );

    // Se todos os destinatários foram processados, marca como completada
    if (processedCount >= campaign.totalRecipients) {
      this.logger.log(`🏁 Todos destinatários processados! Finalizando campanha ${campaignId}`);
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      // Limpa cache de progresso
      this.progressCache.delete(campaignId);

      this.logger.log(
        `✅ Campanha ${campaignId} completada! Total: ${campaign.totalRecipients}, Enviados: ${campaign.sentCount}, Falhas: ${campaign.failedCount}`,
      );

      // Aguarda alguns segundos para os webhooks de status (delivered/read) chegarem
      this.logger.log(`⏳ Aguardando 5 segundos para coletar status updates do WhatsApp...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Busca os dados atualizados após o delay
      const updatedCampaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!updatedCampaign) {
        this.logger.error(`Campanha ${campaignId} não encontrada após conclusão!`);
        return;
      }

      const { successMessages, failedMessages } = await this.buildCompletionSummaries(campaignId);

      this.logger.log(
        `📦 Preparando webhook final (sucesso=${successMessages.length}, falhas=${failedMessages.length}) para campanha ${campaignId}`,
      );
      this.logger.log(
        `📊 Status final: sent=${updatedCampaign.sentCount}, delivered=${updatedCampaign.deliveredCount}, read=${updatedCampaign.readCount}, failed=${updatedCampaign.failedCount}`,
      );

      // Envia webhook final de conclusão com dados atualizados
      await this.campaignWebhookService.sendUpdateStatus(updatedCampaign);
      await this.campaignWebhookService.sendBroadcastSummary(updatedCampaign, {
        status: 'COMPLETED',
        totalContacts: updatedCampaign.totalRecipients,
        sentContacts: updatedCampaign.sentCount,
        failedContacts: updatedCampaign.failedCount,
        pendingContacts: 0,
        successMessages,
        failedMessages,
      });
      this.logger.log(`📬 Webhooks finais enviados para campanha ${campaignId}`);
    }
  }

  private async bufferCounters(
    campaignId: string,
    deltas: { sentDelta?: number; failedDelta?: number },
  ): Promise<void> {
    const now = Date.now();
    const entry =
      this.counterBuffer.get(campaignId) ||
      ({ sentDelta: 0, failedDelta: 0, lastFlush: now } as const as {
        sentDelta: number;
        failedDelta: number;
        lastFlush: number;
        flushPromise?: Promise<void>;
      });

    entry.sentDelta += deltas.sentDelta ?? 0;
    entry.failedDelta += deltas.failedDelta ?? 0;
    this.counterBuffer.set(campaignId, entry);

    const totalDelta = entry.sentDelta + entry.failedDelta;
    const elapsed = now - entry.lastFlush;
    const shouldFlush = totalDelta >= 50 || elapsed >= 2000;

    if (shouldFlush) {
      await this.flushCounters(campaignId, false);
    }
  }

  private async flushCounters(campaignId: string, force: boolean): Promise<void> {
    const entry = this.counterBuffer.get(campaignId);
    if (!entry) {
      return;
    }

    const now = Date.now();
    const totalDelta = entry.sentDelta + entry.failedDelta;
    if (!force && totalDelta === 0) {
      return;
    }

    const sentDelta = entry.sentDelta;
    const failedDelta = entry.failedDelta;
    entry.sentDelta = 0;
    entry.failedDelta = 0;
    entry.lastFlush = now;
    this.counterBuffer.set(campaignId, entry);

    if (sentDelta === 0 && failedDelta === 0) {
      return;
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: { increment: sentDelta },
        failedCount: { increment: failedDelta },
      },
    });
  }

  private async bufferMessageResult(
    campaignId: string,
    result: MessageResultItem,
  ): Promise<void> {
    const now = Date.now();
    const entry = this.messageResultsBuffer.get(campaignId) || {
      items: [],
      firstBuffered: now,
    };

    entry.items.push(result);
    this.messageResultsBuffer.set(campaignId, entry);

    const shouldFlush = entry.items.length >= 50 || (now - entry.firstBuffered) >= 5000;

    if (shouldFlush) {
      await this.flushMessageResults(campaignId, false);
    }
  }

  private async flushMessageResults(campaignId: string, force: boolean): Promise<void> {
    const entry = this.messageResultsBuffer.get(campaignId);
    if (!entry || entry.items.length === 0) {
      return;
    }

    if (!force && entry.items.length === 0) {
      return;
    }

    const items = [...entry.items];
    entry.items = [];
    entry.firstBuffered = Date.now();
    this.messageResultsBuffer.set(campaignId, entry);

    try {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        this.logger.warn(`Campanha ${campaignId} não encontrada para flush de messageResults`);
        return;
      }

      await this.campaignWebhookService.sendMessageResults(campaign, items);
    } catch (error) {
      this.logger.error(
        `Erro ao enviar webhook messageResults para campanha ${campaignId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Verifica se o horário atual está dentro da janela de envio do template.
   * Se fora da janela, calcula o delay até o próximo startTime.
   */
  private async checkTimeWindow(
    campaignId: string,
    templateName: string,
  ): Promise<{
    outsideWindow: boolean;
    delayMs?: number;
    window?: { startTime: string; endTime: string };
  }> {
    try {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { timeWindows: true },
      });

      const timeWindows = (campaign?.timeWindows as any[]) || [];
      if (!timeWindows || timeWindows.length === 0) {
        return { outsideWindow: false };
      }

      // Encontra a janela do template ou usa a primeira como fallback
      const window =
        timeWindows.find((w: any) => w.templateName === templateName) || timeWindows[0];

      if (!window || !window.startTime || !window.endTime) {
        return { outsideWindow: false };
      }

      // Usa timezone da janela (default: America/Sao_Paulo)
      const tz = window.timezone || 'America/Sao_Paulo';
      const now = new Date();
      const localTime = new Date(
        now.toLocaleString('en-US', { timeZone: tz }),
      );
      const currentMinutes = localTime.getHours() * 60 + localTime.getMinutes();
      const [startH, startM] = window.startTime.split(':').map(Number);
      const [endH, endM] = window.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      // Suporte a janelas overnight (ex: 22:00-06:00)
      const isOvernight = endMinutes <= startMinutes;
      let isInside: boolean;

      if (isOvernight) {
        // Janela cruza meia-noite: dentro se >= start OU < end
        isInside = currentMinutes >= startMinutes || currentMinutes < endMinutes;
      } else {
        // Janela normal: dentro se >= start E < end
        isInside = currentMinutes >= startMinutes && currentMinutes < endMinutes;
      }

      this.logger.debug(
        `⏰ TimeWindow check: template=${templateName}, tz=${tz}, ` +
        `now=${localTime.getHours()}:${String(localTime.getMinutes()).padStart(2,'0')} (${currentMinutes}min), ` +
        `window=${window.startTime}-${window.endTime} (${startMinutes}-${endMinutes}min), ` +
        `overnight=${isOvernight}, inside=${isInside}`,
      );

      if (isInside) {
        return { outsideWindow: false };
      }

      // Fora da janela — calcular delay até o próximo startTime
      let delayMs: number;
      if (currentMinutes >= startMinutes) {
        // Já passou do start (e do end também) — agendar para amanhã no startTime
        delayMs = (24 * 60 - currentMinutes + startMinutes) * 60000;
      } else {
        // Antes do início — agendar para hoje no startTime
        delayMs = (startMinutes - currentMinutes) * 60000;
      }

      // Safety: mínimo 1min delay para evitar loop agressivo
      delayMs = Math.max(delayMs, 60000);

      return { outsideWindow: true, delayMs, window };
    } catch (error) {
      this.logger.warn(
        `Erro ao verificar time window: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { outsideWindow: false };
    }
  }

  /**
   * Pausa a broadcast-queue por ~60s e agenda um resume. Se vários jobs
   * paralelos entrarem em backpressure no mesmo período, só a primeira
   * pausa agenda o resume (os demais reaproveitam a janela existente).
   */
  private async applyBackpressure(cooldownMs = 60_000): Promise<void> {
    const now = Date.now();
    if (now < this.backpressureUntil) {
      return;
    }
    this.backpressureUntil = now + cooldownMs;

    try {
      await this.queueService.pauseQueue();
      this.logger.warn(`Backpressure: fila pausada por ${cooldownMs}ms`);
    } catch (err) {
      this.logger.error(
        `Falha ao pausar fila para backpressure: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.backpressureUntil = 0;
      return;
    }

    setTimeout(async () => {
      try {
        await this.queueService.resumeQueue();
        this.logger.log('Backpressure: fila retomada');
      } catch (err) {
        this.logger.error(
          `Falha ao retomar fila após backpressure: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.backpressureUntil = 0;
      }
    }, cooldownMs).unref?.();
  }

  private async pushToDlq(job: {
    campaignId: string;
    recipientId: string;
    phoneNumber: string;
    error: string;
    errorCode?: number | string;
    attempts: number;
    permanent: boolean;
  }): Promise<void> {
    try {
      await this.dlq.add(
        'failed-message',
        {
          ...job,
          timestamp: new Date().toISOString(),
        },
        {
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      );
    } catch (err) {
      this.logger.error(
        `Falha ao enviar job para DLQ: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async buildCompletionSummaries(campaignId: string): Promise<{
    successMessages: BroadcastMessageSummary[];
    failedMessages: BroadcastMessageSummary[];
  }> {
    const [successfulRecipients, failedRecipients] = await Promise.all([
      this.prisma.campaignRecipient.findMany({
        where: {
          campaignId,
          isActive: true,
          status: {
            in: ['SENT', 'DELIVERED', 'READ'],
          },
        },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          status: true,
          metadata: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              externalId: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
              failedAt: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      }),
      this.prisma.campaignRecipient.findMany({
        where: {
          campaignId,
          isActive: true,
          status: 'FAILED',
        },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          status: true,
          metadata: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              externalId: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
              failedAt: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      }),
    ]);

    const successMessages = successfulRecipients.map((recipient) =>
      this.mapRecipientSummary(recipient),
    );
    const failedMessages = failedRecipients.map((recipient) => this.mapRecipientSummary(recipient));

    return { successMessages, failedMessages };
  }

  private mapRecipientSummary(recipient: {
    id: string;
    phoneNumber: string;
    name: string | null;
    status: MessageStatus;
    metadata: any;
    messages: Array<{
      id: string;
      externalId: string | null;
      status: MessageStatus;
      sentAt: Date | null;
      deliveredAt: Date | null;
      readAt: Date | null;
      failedAt: Date | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
  }): BroadcastMessageSummary {
    const [lastMessage] = recipient.messages;
    const metadata = this.normalizeMetadata(recipient.metadata);

    return {
      recipientId: recipient.id,
      phoneNumber: recipient.phoneNumber,
      name: recipient.name,
      status: recipient.status,
      messageId: lastMessage?.id ?? null,
      externalId: lastMessage?.externalId ?? metadata.externalId ?? null,
      sentAt: lastMessage?.sentAt ?? metadata.sentAt ?? null,
      deliveredAt: lastMessage?.deliveredAt ?? metadata.deliveredAt ?? null,
      readAt: lastMessage?.readAt ?? metadata.readAt ?? null,
      failedAt: lastMessage?.failedAt ?? metadata.failedAt ?? null,
      errorCode: lastMessage?.errorCode ?? metadata.errorCode ?? null,
      errorMessage: lastMessage?.errorMessage ?? metadata.error ?? metadata.errorMessage ?? null,
    };
  }

  private normalizeMetadata(metadata: any): Record<string, any> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata as Record<string, any>;
  }
}

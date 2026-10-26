import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
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
import { DispatchResult } from '../services/channel-dispatcher.interface';

/**
 * Estados em que o destinatario ja foi resolvido: o provedor aceitou (SENT e
 * seguintes) ou a falha final ja foi contada. Job que encontra o recipient num
 * destes estados nao envia de novo (BC-01).
 */
const FINAL_RECIPIENT_STATUSES: MessageStatus[] = [
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'REJECTED',
];

/**
 * Compatibilidade de deploy: o codigo anterior gravava o recipient FAILED ja
 * na tentativa intermediaria (antes do retry) e so contava a falha na ultima.
 * Um retry em voo na hora do deploy encontraria esse FAILED "provisorio" e, se
 * fosse descartado, o destinatario nao seria contado e a campanha nunca
 * fecharia. A falha final deste codigo leva `finalFailure: true`; FAILED sem a
 * marca, gravado pelo catch antigo (attemptNumber de uma tentativa anterior a
 * deste retry), e tratado como pendente. FAILED do webhook do provedor nao tem
 * attemptNumber e continua bloqueando.
 */
function isLegacyIntermediateFailure(
  status: MessageStatus,
  metadata: unknown,
  attemptsMade: number,
): boolean {
  if (status !== 'FAILED' || attemptsMade <= 0) return false;
  const meta = metadata && typeof metadata === 'object' ? (metadata as Record<string, any>) : {};
  return (
    meta.finalFailure !== true &&
    typeof meta.attemptNumber === 'number' &&
    meta.attemptNumber < attemptsMade
  );
}

/**
 * Transacao do aceite: o maxWait padrao do Prisma (2s para obter conexao)
 * estoura com 100 jobs por processo disputando o pool e vira "ACEITE SEM
 * REGISTRO". 10s para conseguir a conexao e 10s para os 2 comandos.
 */
const ACCEPTANCE_TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 };

const FINAL_EXCEPT_FAILED = FINAL_RECIPIENT_STATUSES.filter((s) => s !== 'FAILED');

/**
 * BC-04: rate limit/breaker do canal adia SO o job daquele canal (moveToDelayed
 * com o token do worker + DelayedError), sem consumir `attempts` e sem pausar a
 * fila dos outros tenants. O limite de adiamentos e contado a parte, no
 * `job.data`; esgotado, o destinatario vira FAILED com motivo (nunca some).
 */
export const MAX_BACKPRESSURE_DEFERRALS = 30;

/**
 * Erros em que o envio comprovadamente nao saiu: rate limit da Meta (o Diogenes
 * manda `BACKPRESSURE ... meta=NNN`), HTTP 429 (`http=429`) ou breaker aberto
 * (nem chamou o provedor). Um BACKPRESSURE sem um desses marcadores nao adia.
 */
export function isProvenNotSent(message: string): boolean {
  if (message.startsWith('Circuit breaker aberto')) return true;
  return message.startsWith('BACKPRESSURE:') && /\b(meta=\d+|http=429)\b/.test(message);
}

/**
 * Codigo da falha de quem esgotou os adiamentos, no formato que o CRM le:
 * o da Meta (meta=130429); 429 sem codigo da Meta vira 130429 ("Cloud API rate
 * limit"), para o freio por ritmo do CRM contar; breaker aberto por 5xx leva o
 * status HTTP.
 */
export function backpressureErrorCode(message: string): string {
  const meta = /\bmeta=(\d+)/.exec(message)?.[1];
  if (meta) return meta;
  const http = /\bhttp=(\d+)/.exec(message)?.[1];
  if (http === '429') return '130429';
  return http ?? 'BACKPRESSURE';
}
const BACKPRESSURE_DEFAULT_DELAY_MS = 60_000;
const BACKPRESSURE_MIN_DELAY_MS = 5_000;
const BACKPRESSURE_JITTER_MS = 5_000;

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
  /** Quantas vezes o job foi adiado por rate limit/breaker do canal (BC-04). */
  backpressureDeferrals?: number;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcherFactory: ChannelDispatcherFactory,
    private readonly campaignWebhookService: CampaignWebhookService,
    @InjectQueue('broadcast-dlq') private readonly dlq: Queue<DeadLetterJob>,
  ) {
    super();
  }

  async process(job: Job<SendMessageJob>, token?: string): Promise<any> {
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
      return this.delayJob(job, token, Date.now() + delayMs);
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
      return this.delayJob(job, token, Date.now() + (timeWindowCheck.delayMs || 60000));
    }

    this.logger.log(
      `Processando envio para ${recipientName} (${recipientPhone}) - Campanha: ${campaignId}`,
    );

    // BC-01: no maximo um envio por destinatario. Antes de chamar o provedor,
    // rele o recipient: se ja saiu de QUEUED/PENDING (outro job, retry depois de
    // aceite, requeue), nao envia de novo. Se ja existe Message com externalId,
    // o provedor aceitou numa execucao anterior que caiu antes de marcar o
    // recipient: conclui o registro sem reenviar.
    const recipientState = await this.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      select: {
        status: true,
        metadata: true,
        messages: {
          where: { externalId: { not: null } },
          select: { id: true, externalId: true },
          take: 1,
        },
      },
    });
    if (!recipientState) {
      this.logger.warn(`⏭️ Destinatario ${recipientId} inexistente — job descartado (sem envio)`);
      return { success: false, reason: 'recipient_not_found', skipped: true };
    }
    const legacyFailure = isLegacyIntermediateFailure(
      recipientState.status,
      recipientState.metadata,
      job.attemptsMade,
    );
    // Estados que bloqueiam a transicao deste job (ver isLegacyIntermediateFailure).
    const blocked = legacyFailure ? FINAL_EXCEPT_FAILED : FINAL_RECIPIENT_STATUSES;
    if (legacyFailure) {
      this.logger.warn(
        `↩️ Recipient ${recipientId} em FAILED de tentativa intermediaria (codigo anterior) — ` +
          `seguindo com o retry`,
      );
    }
    if (blocked.includes(recipientState.status)) {
      this.logger.warn(
        `⏭️ Destinatario ${recipientId} ja em ${recipientState.status} — job descartado (sem reenvio)`,
      );
      return { success: false, reason: 'recipient_already_processed', skipped: true };
    }
    const [acceptedMessage] = recipientState.messages ?? [];
    if (acceptedMessage) {
      this.logger.warn(
        `♻️ Destinatario ${recipientId} ja aceito pelo provedor (${acceptedMessage.externalId}) — ` +
          `concluindo o registro sem reenviar`,
      );
      return this.recordAcceptedSend(job, {
        externalId: acceptedMessage.externalId,
        messageId: acceptedMessage.id,
        reconciled: true,
        blocked,
      });
    }

    let result: DispatchResult;
    try {
      // Obtém o dispatcher adequado para o canal
      const dispatcher = this.dispatcherFactory.getDispatcher(channel);

      // Envia via dispatcher (WhatsApp → Diogenes, RCS → Pontaltech)
      result = await dispatcher.sendMessage(job.data);
    } catch (error) {
      return this.handleSendFailure(job, error, blocked, token);
    }

    // Daqui em diante o provedor ACEITOU: nenhum erro pode virar FAILED nem
    // relancar para o BullMQ (relancar = reenviar ao mesmo telefone).
    return this.recordAcceptedSend(job, {
      externalId: result.externalId ?? null,
      metadata: result.metadata,
      blocked,
    });
  }

  /**
   * Registra um envio aceito pelo provedor. Nunca lanca: cada passo falha
   * sozinho e so loga. A Message e gravada por upsert no externalId (unico),
   * o recipient so passa a SENT se ainda nao estava em estado final (update
   * condicional) e o contador so soma quando essa transicao aconteceu — assim
   * o mesmo destinatario nunca conta duas vezes em sent+failed.
   */
  private async recordAcceptedSend(
    job: Job<SendMessageJob>,
    accepted: {
      externalId: string | null;
      metadata?: Record<string, any>;
      messageId?: string;
      reconciled?: boolean;
      blocked?: MessageStatus[];
    },
  ): Promise<any> {
    const { campaignId, recipientId, recipientPhone, recipientName, templateData, templateName } =
      job.data;
    const sentAt = new Date();
    let messageId: string | null = accepted.messageId ?? null;
    const data = {
      campaignId,
      recipientId,
      templateId: templateData?.id || templateName,
      externalId: accepted.externalId,
      phoneNumber: recipientPhone,
      status: 'SENT' as MessageStatus,
      sentAt,
      metadata: accepted.metadata || {},
    };

    // Message e recipient na MESMA transacao: o webhook do provedor acha a
    // Message pelo externalId e mexe no recipient (delivered/read/sent). Se a
    // Message ficasse visivel antes do recipient virar SENT, o webhook o levaria
    // a DELIVERED, o update condicional afetaria 0 linhas e ninguem contaria o
    // envio — a campanha nunca fecharia. Com a transacao, o webhook so enxerga a
    // Message depois do commit, com o recipient ja SENT e contado aqui.
    let transitioned = false;
    try {
      const outcome = await this.retryPersistence(() =>
        this.prisma.$transaction(async (tx) => {
          let id = accepted.messageId ?? null;
          if (!id) {
            const message = accepted.externalId
              ? await tx.message.upsert({
                  where: { externalId: accepted.externalId },
                  create: data,
                  update: {},
                })
              : await tx.message.create({ data });
            id = message.id;
          }
          const { count } = await tx.campaignRecipient.updateMany({
            where: {
              id: recipientId,
              status: { notIn: accepted.blocked ?? FINAL_RECIPIENT_STATUSES },
            },
            data: { status: 'SENT', sentAt },
          });
          return { id, transitioned: count === 1 };
        }, ACCEPTANCE_TX_OPTIONS),
      );
      messageId = outcome.id;
      transitioned = outcome.transitioned;
    } catch (error) {
      // Nem Message nem recipient foram gravados (rollback): nao ha registro do
      // aceite. Nao relanca (o retry reenviaria); o recipient fica QUEUED.
      this.logger.error(
        `ACEITE SEM REGISTRO: provedor aceitou (externalId=${accepted.externalId ?? 'n/d'}) ` +
          `para recipient ${recipientId} da campanha ${campaignId}, mas a gravacao falhou: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (transitioned) {
      try {
        // Atualiza contadores da campanha com buffer (reduz writes)
        await this.bufferCounters(campaignId, { sentDelta: 1 });

        // Bufferiza resultado da mensagem para webhook em lote
        await this.bufferMessageResult(campaignId, {
          phoneNumber: recipientPhone,
          name: recipientName,
          externalId: accepted.externalId ?? null,
          status: 'SENT',
          sentAt: sentAt.toISOString(),
          errorMessage: null,
          errorCode: null,
        });
      } catch (error) {
        this.logger.error(
          `Erro ao contabilizar envio aceito do recipient ${recipientId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await this.afterRecipientSettled(campaignId);

    this.logger.log(
      `Mensagem enviada com sucesso! ID: ${messageId ?? 'n/d'} | External ID: ${accepted.externalId}`,
    );

    return {
      success: true,
      messageId,
      externalId: accepted.externalId,
      ...(accepted.reconciled ? { reconciled: true } : {}),
    };
  }

  /**
   * Repete uma escrita curta no banco (erro transitorio de conexao/pool) antes
   * de desistir: 3 tentativas, com 100ms e 500ms entre elas.
   */
  private async retryPersistence<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [100, 500];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= delays.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  /**
   * Progresso + conclusao depois que um destinatario terminou (aceito ou
   * falha final). Erro aqui so loga: relancar faria o BullMQ repetir o job.
   */
  private async afterRecipientSettled(campaignId: string): Promise<void> {
    try {
      // Envia webhook de progresso (throttled)
      const updatedCampaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (updatedCampaign) {
        await this.sendProgressWebhook(updatedCampaign);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao enviar progresso da campanha ${campaignId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      // Verifica se todos os destinatários foram processados
      await this.checkAndCompleteCampaign(campaignId);
    } catch (error) {
      this.logger.error(
        `Erro ao verificar conclusao da campanha ${campaignId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * O provedor NAO aceitou (sendMessage lancou). Tentativa intermediaria:
   * registra a tentativa e relanca para o retry, sem mexer no recipient. Falha
   * final (permanente ou ultima tentativa): marca o recipient FAILED por update
   * condicional e so entao conta a falha e manda o item ao CRM.
   */
  private async handleSendFailure(
    job: Job<SendMessageJob>,
    error: any,
    blocked: MessageStatus[] = FINAL_RECIPIENT_STATUSES,
    token?: string,
  ): Promise<any> {
    const { campaignId, recipientId, recipientPhone, recipientName, templateData, templateName } =
      job.data;
    this.logger.error(`Erro ao processar envio para ${recipientPhone}: ${error.message}`);

    // Rate limit da Meta, HTTP 429 ou circuit breaker aberto do canal: o provedor
    // comprovadamente NAO aceitou. So esses adiam o job sem consumir attempts
    // (nao pausa a fila). 5xx e ambiguo (pode ter saido) e segue pelas attempts.
    // Esgotado o limite de adiamentos, cai na falha final com motivo.
    const msg = typeof error.message === 'string' ? error.message : '';
    const backpressure = isProvenNotSent(msg);
    if (backpressure) {
      const deferrals = (job.data.backpressureDeferrals ?? 0) + 1;
      if (deferrals <= MAX_BACKPRESSURE_DEFERRALS) {
        return this.deferForBackpressure(job, token, deferrals, msg);
      }
      this.logger.error(
        `Backpressure do canal ${job.data.channel} persistiu por ${deferrals - 1} adiamentos — ` +
          `recipient ${recipientId} marcado como falha`,
      );
    }

    const metaError = isMetaApiError(error) ? (error as MetaApiError) : null;

    // Permanente: HTTP 4xx específico OU código Meta classificado como permanente.
    const isPermanentByHttp =
      error.response?.status && [400, 401, 403, 404, 422].includes(error.response.status);
    const isPermanentByMeta = metaError?.policy === 'permanent';
    // Backpressure esgotado tambem e final: relancar so consumiria attempts.
    const isPermanentError = Boolean(isPermanentByHttp || isPermanentByMeta || backpressure);

    if (isPermanentError) {
      const reason = metaError
        ? `Meta #${metaError.metaCode}`
        : backpressure
          ? 'backpressure esgotado'
          : `HTTP ${error.response.status}`;
      this.logger.error(`Erro permanente (${reason}) - não será feito retry`);
    }

    const httpStatusCode =
      metaError?.httpStatusCode ?? error.response?.status ?? 'UNKNOWN';
    const errorCode = metaError
      ? String(metaError.metaCode)
      : backpressure
        ? backpressureErrorCode(msg)
        : String(httpStatusCode);
    const errorMessage = backpressure
      ? `Limite de envio do canal persistiu apos ${MAX_BACKPRESSURE_DEFERRALS} adiamentos: ${msg}`
      : (metaError?.metaMessage ?? error.message);
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

    // Registro da tentativa (historico; sem externalId, nao conta como aceite)
    try {
      await this.prisma.message.create({
        data: {
          campaignId,
          recipientId,
          templateId: templateData?.id || templateName,
          phoneNumber: recipientPhone,
          status: 'FAILED',
          failedAt: new Date(),
          errorCode,
          errorMessage,
          metadata: failureMetadata,
        },
      });
    } catch (persistError) {
      this.logger.error(
        `Erro ao registrar tentativa falha do recipient ${recipientId}: ` +
          `${persistError instanceof Error ? persistError.message : String(persistError)}`,
      );
    }

    const attempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attempts;

    // Para erros temporários (500, timeout, etc) com tentativa sobrando: retry.
    // O recipient continua QUEUED — FAILED so na falha final, senao o guard de
    // idempotencia descartaria o proprio retry.
    if (!isPermanentError && !isLastAttempt) {
      throw error;
    }

    let transitioned = false;
    try {
      const { count } = await this.retryPersistence(() =>
        this.prisma.campaignRecipient.updateMany({
          where: { id: recipientId, status: { notIn: blocked } },
          data: {
            status: 'FAILED',
            metadata: {
              ...failureMetadata,
              error: errorMessage,
              errorCode,
              failedAt: new Date(),
              attemptNumber: job.attemptsMade,
              finalFailure: true,
            },
          },
        }),
      );
      transitioned = count === 1;
    } catch (persistError) {
      // O provedor NAO aceitou: relancar e seguro (o retry pode reenviar sem
      // risco de duplicata). Concluir o job aqui deixaria o recipient QUEUED sem
      // contar e a campanha sem fechar.
      this.logger.error(
        `Erro ao marcar recipient ${recipientId} como FAILED — relancando para retry: ` +
          `${persistError instanceof Error ? persistError.message : String(persistError)}`,
      );
      throw error;
    }

    // So conta a falha (e avisa o CRM) se ESTE job tirou o recipient do estado
    // pendente — evita contar duas vezes o mesmo destinatario.
    if (transitioned) {
      try {
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
      } catch (countError) {
        this.logger.error(
          `Erro ao contabilizar falha do recipient ${recipientId}: ` +
            `${countError instanceof Error ? countError.message : String(countError)}`,
        );
      }
    }

    await this.afterRecipientSettled(campaignId);

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
      // BC-02: transicao condicional. Varios jobs (deste e de outros processos)
      // podem chegar aqui juntos; so quem tirou a campanha de PROCESSING manda
      // os webhooks finais.
      const { count } = await this.prisma.campaign.updateMany({
        where: { id: campaignId, status: 'PROCESSING' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      if (count !== 1) {
        this.logger.debug(
          `⏭️ Campanha ${campaignId} ja foi concluida por outro job — sem webhook final duplicado`,
        );
        return;
      }
      this.logger.log(`🏁 Todos destinatários processados! Finalizando campanha ${campaignId}`);

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
   * Re-atrasa o job e sinaliza ao BullMQ com DelayedError (BC-11): o worker nao
   * tenta completar um job que ja saiu de `active`. O token e o do worker que
   * tem o lock; sem ele o BullMQ usa "0" e o lock nao e liberado.
   */
  private async delayJob(
    job: Job<SendMessageJob>,
    token: string | undefined,
    timestamp: number,
  ): Promise<never> {
    await job.moveToDelayed(timestamp, token);
    throw new DelayedError();
  }

  /**
   * BC-04: adia so este job (canal com rate limit/breaker aberto). O tempo vem
   * do proprio breaker ("Aguarde Nms") ou do padrao de 60s, com jitter para os
   * jobs do canal nao voltarem todos no mesmo instante. Nao ha pausa global nem
   * timer em memoria: o atraso vive no Redis, junto do job.
   */
  private async deferForBackpressure(
    job: Job<SendMessageJob>,
    token: string | undefined,
    deferrals: number,
    reason: string,
  ): Promise<never> {
    const waitMatch = /Aguarde (\d+)ms/.exec(reason);
    const baseDelay = waitMatch ? Number(waitMatch[1]) : BACKPRESSURE_DEFAULT_DELAY_MS;
    const delayMs =
      Math.max(baseDelay, BACKPRESSURE_MIN_DELAY_MS) +
      Math.floor(Math.random() * BACKPRESSURE_JITTER_MS);

    this.logger.warn(
      `Backpressure no canal ${job.data.channel}: job ${job.id} adiado ${delayMs}ms ` +
        `(${deferrals}/${MAX_BACKPRESSURE_DEFERRALS}) — ${reason}`,
    );

    await job.updateData({ ...job.data, backpressureDeferrals: deferrals });
    return this.delayJob(job, token, Date.now() + delayMs);
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

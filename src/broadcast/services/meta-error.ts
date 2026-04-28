/**
 * Erros retornados pela WhatsApp Cloud API (Meta) via Diogenes.
 *
 * Esses erros chegam com HTTP 200 mas com um payload no formato:
 *   { message, type, code, error_data: { details, ... }, fbtrace_id }
 *
 * Como não vêm com `key.id`, a validação do DiogenesService rejeitava todos
 * com a mesma mensagem genérica. Este módulo classifica o erro pelo `code`
 * para decidir se o envio deve ser retentado, se a fila precisa pausar
 * (rate limit) ou se a falha é permanente.
 *
 * Ref: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export type MetaErrorPolicy = 'permanent' | 'retry' | 'rate_limit';

export class MetaApiError extends Error {
  readonly metaCode: number;
  readonly metaMessage: string;
  readonly metaDetails?: string;
  readonly fbtraceId?: string;
  readonly httpStatusCode?: number;
  readonly policy: MetaErrorPolicy;
  readonly rawPayload: unknown;

  constructor(args: {
    metaCode: number;
    metaMessage: string;
    metaDetails?: string;
    fbtraceId?: string;
    httpStatusCode?: number;
    policy: MetaErrorPolicy;
    rawPayload: unknown;
  }) {
    super(`Meta #${args.metaCode}: ${args.metaMessage}`);
    this.name = 'MetaApiError';
    this.metaCode = args.metaCode;
    this.metaMessage = args.metaMessage;
    this.metaDetails = args.metaDetails;
    this.fbtraceId = args.fbtraceId;
    this.httpStatusCode = args.httpStatusCode;
    this.policy = args.policy;
    this.rawPayload = args.rawPayload;
  }
}

interface MetaErrorPayload {
  message?: string;
  code?: number | string;
  type?: string;
  error_data?: { details?: string; messaging_product?: string };
  fbtrace_id?: string;
  error_subcode?: number | string;
}

/** Códigos com falha permanente — não adianta retentar. */
const PERMANENT_CODES = new Set<number>([
  131005, // Recipient phone number not in allowed list
  131008, // Required parameter missing
  131009, // Parameter value not valid
  131021, // Recipient cannot be sender
  131026, // Message undeliverable (número não no WhatsApp ou bloqueado)
  131031, // Account locked
  131045, // Account-level capability not granted
  131047, // Re-engagement message — fora da janela de 24h sem template
  131051, // Unsupported message type
  131056, // Pair rate limit (par sender/recipient bloqueado)
  132000, // Number of parameters mismatch
  132001, // Template does not exist
  132005, // Translated text too long
  132007, // Template format character policy violated
  132012, // Parameter format mismatch
  132015, // Template paused / disabled
  132016, // Template paused for low quality
  132068, // Flow blocked
  132069, // Flow with errors
]);

/**
 * Códigos que indicam rate limit / pacing — devem pausar a fila inteira
 * por um período antes de retentar.
 */
const RATE_LIMIT_CODES = new Set<number>([
  130429, // Rate limit hit (mensagens por segundo do número emissor)
  131048, // Spam rate limit hit
  368, // Temporarily blocked for policies violations
  133016, // Account register rate limit
]);

/**
 * Tenta extrair um MetaApiError de uma resposta do Diogenes que veio
 * sem `key.id`. Retorna `null` se o payload não tiver formato de erro Meta.
 */
export function tryParseMetaError(
  payload: unknown,
  httpStatusCode?: number,
): MetaApiError | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as MetaErrorPayload & {
    error?: MetaErrorPayload;
    response?: { error?: MetaErrorPayload };
  };

  // O Diogenes pode repassar o payload da Meta diretamente, dentro de
  // `error`, ou dentro de `response.error`. Cobrimos os três formatos.
  const metaPayload: MetaErrorPayload | undefined =
    typeof candidate.code !== 'undefined' || typeof candidate.message !== 'undefined'
      ? candidate
      : candidate.error ?? candidate.response?.error;

  if (!metaPayload) {
    return null;
  }

  const codeRaw = metaPayload.code;
  const code =
    typeof codeRaw === 'number'
      ? codeRaw
      : typeof codeRaw === 'string' && /^\d+$/.test(codeRaw)
        ? parseInt(codeRaw, 10)
        : NaN;

  if (Number.isNaN(code)) {
    return null;
  }

  return new MetaApiError({
    metaCode: code,
    metaMessage: metaPayload.message ?? 'Erro Meta sem mensagem',
    metaDetails: metaPayload.error_data?.details,
    fbtraceId: metaPayload.fbtrace_id,
    httpStatusCode,
    policy: classifyMetaCode(code),
    rawPayload: payload,
  });
}

export function classifyMetaCode(code: number): MetaErrorPolicy {
  if (RATE_LIMIT_CODES.has(code)) return 'rate_limit';
  if (PERMANENT_CODES.has(code)) return 'permanent';
  // Códigos desconhecidos: retentar uma vez e deixar a heurística do
  // BullMQ decidir. Códigos transitórios conhecidos (131000) também
  // caem aqui.
  return 'retry';
}

export function isMetaApiError(err: unknown): err is MetaApiError {
  return err instanceof MetaApiError;
}

import { PROVIDER_WEBHOOK_TOKEN_HEADER } from './provider-webhook.guard';

/** Marcador que substitui o segredo nos logs. */
export const REDACTED = '[redacted]';

/** Headers com segredo: token de provedor e o Bearer da API. */
const SECRET_HEADERS = new Set<string>([PROVIDER_WEBHOOK_TOKEN_HEADER, 'authorization']);

/**
 * `/webhook/<rota de provedor>/<token>`: o ultimo segmento e o token compartilhado
 * (ProviderWebhookGuard). Casa com e sem o prefixo `api` e com query string.
 */
const TOKEN_IN_PATH = /(\/webhook\/(?:campaign-status|diogenes|rcs)\/)[^/?#]+/i;

/** Tira o token de provedor do caminho antes de logar. */
export function redactWebhookUrl(url: string | undefined | null): string {
  return String(url ?? '').replace(TOKEN_IN_PATH, `$1${REDACTED}`);
}

/** Copia dos headers com os segredos trocados pelo marcador. */
export function redactHeaders(
  headers: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    copy[name] = SECRET_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return copy;
}

/**
 * Copia dos params sem o token: o `:token` da rota do webhook e tambem o curinga `path` que o
 * LoggerMiddleware (forRoutes('*')) recebe com os segmentos da URL.
 */
export function redactParams(
  params: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    if (name === 'token') {
      copy[name] = REDACTED;
    } else if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
      copy[name] = redactWebhookUrl(`/${value.join('/')}`)
        .slice(1)
        .split('/');
    } else if (typeof value === 'string') {
      copy[name] = redactWebhookUrl(value);
    } else {
      copy[name] = value;
    }
  }
  return copy;
}

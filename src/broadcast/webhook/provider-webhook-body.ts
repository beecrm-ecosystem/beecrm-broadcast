import { json } from 'express';
import type { RequestHandler } from 'express';

/** Prefixo (com o global prefix `api`) das rotas de webhook de provedor. */
export const PROVIDER_WEBHOOK_PATH = '/api/webhook';

/**
 * Parser JSON das rotas de webhook que guarda o corpo CRU em `req.rawBody`.
 *
 * O ProviderWebhookGuard confere o `X-Hub-Signature-256` da Meta sobre os bytes exatos recebidos;
 * re-serializar o JSON ja parseado nao os reproduz (escape de unicode, espacos, ordem). Tem de ser
 * registrado ANTES do parser geral: o body-parser pula a requisicao que ja foi lida.
 */
export function providerWebhookBodyParser(limit = '25mb'): RequestHandler {
  return json({
    limit,
    verify: (req: any, _res, buf: Buffer) => {
      req.rawBody = buf;
    },
  });
}

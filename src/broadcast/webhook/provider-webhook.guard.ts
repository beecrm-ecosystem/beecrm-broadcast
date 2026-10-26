import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Header do token compartilhado com o encaminhador (Diogenes/Pontaltech/repasse da Meta). */
export const PROVIDER_WEBHOOK_TOKEN_HEADER = 'x-webhook-token';

/** Header de assinatura que a Meta manda: `sha256=<hex do HMAC-SHA256(corpo cru, App Secret)>`. */
export const META_SIGNATURE_HEADER = 'x-hub-signature-256';

/** Intervalo entre avisos de "webhook sem autenticacao" (evita inundar o log). */
const UNCONFIGURED_WARNING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Autenticidade dos webhooks de provedor (`/api/webhook/campaign-status`, `/diogenes`, `/rcs`).
 *
 * Antes eram `@Public()` sem verificacao nenhuma: qualquer um que alcancasse o host forjava
 * status, respostas e opt-out (SEC-04/BC-06 da auditoria de 26/10/2026).
 *
 * Aceita, nesta ordem:
 *  1. Token compartilhado (`PROVIDER_WEBHOOK_TOKEN`) no header `X-Webhook-Token` ou como
 *     ultimo segmento da URL (`/api/webhook/<rota>/<token>`) — para encaminhador que so deixa
 *     configurar a URL. Comparacao em tempo constante.
 *  2. So no `campaign-status`: `X-Hub-Signature-256` valido com o App Secret da Meta
 *     (`META_APP_SECRET`), calculado sobre o corpo CRU (ver main.ts). Serve se a Meta, ou um
 *     repasse que preserve corpo e header, chamar a rota.
 *
 * Rollout seguro: sem nenhuma das envs aplicaveis a rota, a requisicao passa como antes e o
 * guard avisa no log (uma vez por hora por rota). Basta configurar a env para fechar.
 */
@Injectable()
export class ProviderWebhookGuard implements CanActivate {
  private readonly logger = new Logger(ProviderWebhookGuard.name);

  /** Ultimo aviso por rota. Estado por processo e so de log: nao decide acesso. */
  private readonly lastWarningAt = new Map<string, number>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const route = this.routeName(request);
    const acceptsMetaSignature = route === 'campaign-status';

    const token = process.env.PROVIDER_WEBHOOK_TOKEN || '';
    const metaSecret = acceptsMetaSignature ? process.env.META_APP_SECRET || '' : '';

    if (!token && !metaSecret) {
      this.warnUnconfigured(route);
      return true;
    }

    if (token && this.tokenMatches(this.providedToken(request), token)) {
      return true;
    }

    if (metaSecret && this.metaSignatureMatches(request, metaSecret)) {
      return true;
    }

    this.logger.warn(
      `Webhook de provedor recusado (rota=${route}): token/assinatura ausente ou invalido`,
    );
    throw new UnauthorizedException('Webhook nao autenticado');
  }

  private routeName(request: any): string {
    const path: string = String(request?.route?.path ?? request?.path ?? request?.url ?? '');
    const match = path.match(/webhook\/([^/?]+)/);
    return match ? match[1] : 'desconhecida';
  }

  private providedToken(request: any): string | null {
    const header = request?.headers?.[PROVIDER_WEBHOOK_TOKEN_HEADER];
    if (typeof header === 'string' && header !== '') {
      return header;
    }

    const segment = request?.params?.token;
    return typeof segment === 'string' && segment !== '' ? segment : null;
  }

  /** Compara digests de tamanho fixo: nem o conteudo nem o tamanho do token vazam pelo tempo. */
  private tokenMatches(provided: string | null, expected: string): boolean {
    if (!provided) {
      return false;
    }

    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }

  private metaSignatureMatches(request: any, secret: string): boolean {
    const header = request?.headers?.[META_SIGNATURE_HEADER];
    const rawBody: unknown = request?.rawBody;

    if (typeof header !== 'string' || !header.startsWith('sha256=')) {
      return false;
    }

    // Sem o corpo cru nao ha como conferir (re-serializar o JSON nao reproduz os bytes da Meta).
    if (!Buffer.isBuffer(rawBody)) {
      return false;
    }

    const provided = Buffer.from(header.slice('sha256='.length), 'hex');
    const expected = createHmac('sha256', secret).update(rawBody).digest();

    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  private warnUnconfigured(route: string): void {
    const now = Date.now();
    const last = this.lastWarningAt.get(route) ?? 0;
    if (now - last < UNCONFIGURED_WARNING_INTERVAL_MS) {
      return;
    }

    this.lastWarningAt.set(route, now);
    this.logger.warn(
      `Webhook de provedor SEM autenticacao (rota=${route}): configure PROVIDER_WEBHOOK_TOKEN` +
        (route === 'campaign-status' ? ' ou META_APP_SECRET' : '') +
        ' para recusar origem nao autenticada.',
    );
  }
}

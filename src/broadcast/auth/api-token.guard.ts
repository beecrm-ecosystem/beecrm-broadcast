import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Autenticação da REST API consumida pelo BeeCRM.
 *
 * A API (`/api/broadcast`, `/api/metrics`, `/api/logs`, `/api/queue`) estava
 * 100% aberta — qualquer um que alcançasse o host criava/cancelava campanhas e
 * lia PII dos destinatários. Este guard exige um Bearer token igual a
 * `BROADCAST_SERVICE_TOKEN` (o mesmo que o CRM já envia).
 *
 * Rollout seguro (fail-open quando não configurado): se `BROADCAST_SERVICE_TOKEN`
 * não estiver setado, o guard NÃO bloqueia — apenas loga um aviso. Isso evita
 * repetir o incidente de guard fail-closed derrubando a fleet quando o secret
 * não foi propagado. Basta setar a env para habilitar a autenticação.
 *
 * Rotas `@Public()` (webhooks de provider Meta/Pontaltech, painel estático)
 * ficam de fora — a autenticação dos webhooks de entrada é um card separado.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly logger = new Logger(ApiTokenGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const expected = process.env.BROADCAST_SERVICE_TOKEN;
    if (!expected) {
      this.logger.warn(
        'BROADCAST_SERVICE_TOKEN não configurado — REST API sem autenticação. ' +
          'Configure a env (igual ao BROADCAST_SERVICE_TOKEN do CRM) para habilitar o guard.',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = this.extractToken(request);
    if (!provided || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('Token de API inválido');
    }

    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers['authorization'];
    if (typeof header !== 'string') {
      return null;
    }
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }

  /** Comparação em tempo constante (evita timing attack no token). */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}

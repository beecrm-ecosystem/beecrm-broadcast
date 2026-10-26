import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { redactHeaders, redactParams, redactWebhookUrl } from '../webhook/webhook-log-redaction';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');
  private isProduction = process.env.NODE_ENV === 'production';

  use(req: Request, res: Response, next: NextFunction) {
    const { method, body, query, params } = req;
    // Token de webhook de provedor (segmento de URL / header) nunca vai para o log.
    const originalUrl = redactWebhookUrl(req.originalUrl);
    const startTime = Date.now();

    // Em produção, apenas loga detalhes em debug
    if (this.isProduction) {
      // Log resumido apenas para webhooks
      if (originalUrl.includes('/webhook/')) {
        this.logger.debug(`${method} ${originalUrl}`);
      }
    } else {
      // Em desenvolvimento, loga tudo
      this.logger.log('========== REQUISIÇÃO RECEBIDA ==========');
      this.logger.log(`${method} ${originalUrl}`);
      this.logger.log(`Headers: ${JSON.stringify(redactHeaders(req.headers), null, 2)}`);

      if (body && Object.keys(body).length > 0) {
        this.logger.log(`Body: ${JSON.stringify(body, null, 2)}`);
      }

      if (query && Object.keys(query).length > 0) {
        this.logger.log(`Query: ${JSON.stringify(query)}`);
      }

      if (params && Object.keys(params).length > 0) {
        this.logger.log(`Params: ${JSON.stringify(redactParams(params))}`);
      }
    }

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - startTime;

      if (this.isProduction) {
        // Log resumido em produção - apenas erros
        if (statusCode >= 400) {
          this.logger.warn(`${method} ${originalUrl} - ${statusCode} (${duration}ms)`);
        }
      } else {
        // Em desenvolvimento, loga tudo
        this.logger.log('========== RESPOSTA ENVIADA ==========');
        this.logger.log(`Status: ${statusCode}`);
        this.logger.log(`Duração: ${duration}ms`);
      }
    });

    next();
  }
}

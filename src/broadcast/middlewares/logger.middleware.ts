import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, body, query, params } = req;
    const startTime = Date.now();

    this.logger.log('========== REQUISIÇÃO RECEBIDA ==========');
    this.logger.log(`${method} ${originalUrl}`);
    this.logger.log(`Headers: ${JSON.stringify(req.headers, null, 2)}`);
    
    if (body && Object.keys(body).length > 0) {
      this.logger.log(`Body: ${JSON.stringify(body, null, 2)}`);
    }
    
    if (query && Object.keys(query).length > 0) {
      this.logger.log(`Query: ${JSON.stringify(query)}`);
    }
    
    if (params && Object.keys(params).length > 0) {
      this.logger.log(`Params: ${JSON.stringify(params)}`);
    }

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - startTime;
      
      this.logger.log('========== RESPOSTA ENVIADA ==========');
      this.logger.log(`Status: ${statusCode}`);
      this.logger.log(`Duração: ${duration}ms`);
    });

    next();
  }
}

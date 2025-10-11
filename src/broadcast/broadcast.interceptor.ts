import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class BroadcastInterceptor implements NestInterceptor {
  private readonly logger = new Logger(BroadcastInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const now = Date.now();

    this.logger.log(`[${method}] ${url} - Início`);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - now;
          this.logger.log(`[${method}] ${url} - Sucesso (${duration}ms)`);
        },
        error: (error) => {
          const duration = Date.now() - now;
          this.logger.error(`[${method}] ${url} - Erro (${duration}ms): ${error.message}`);
        },
      }),
    );
  }
}

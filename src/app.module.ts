import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BroadcastModule } from './broadcast/broadcast.module';
import { ApiTokenGuard } from './broadcast/auth/api-token.guard';

/**
 * Escape de deploy (BC-10): com `BROADCAST_API_CONSUMES_QUEUES=true` a API
 * volta a consumir as filas, para instalacao que nao roda o processo `worker`.
 */
export function apiConsumesQueues(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BROADCAST_API_CONSUMES_QUEUES === 'true';
}

@Module({
  imports: [
    // Configuração global do BullMQ
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global de autenticação da REST API (fail-open quando a env não
    // está setada — ver ApiTokenGuard). Rotas @Public() ficam de fora.
    { provide: APP_GUARD, useClass: ApiTokenGuard },
  ],
})
export class AppModule {
  /**
   * Processo HTTP (main.ts): rotas e produtores, sem @Processor — a API nao
   * disputa jobs com os workers nem os derruba a cada reload.
   */
  static forApi(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [BroadcastModule.register({ consumers: apiConsumesQueues(env) })],
    };
  }

  /** Processo de worker (worker.ts): carrega todos os consumidores das filas. */
  static forWorker(): DynamicModule {
    return {
      module: AppModule,
      imports: [BroadcastModule.register({ consumers: true })],
    };
  }
}

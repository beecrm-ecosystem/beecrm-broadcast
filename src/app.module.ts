import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BroadcastModule } from './broadcast/broadcast.module';
import { ApiTokenGuard } from './broadcast/auth/api-token.guard';

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
    BroadcastModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global de autenticação da REST API (fail-open quando a env não
    // está setada — ver ApiTokenGuard). Rotas @Public() ficam de fora.
    { provide: APP_GUARD, useClass: ApiTokenGuard },
  ],
})
export class AppModule {}

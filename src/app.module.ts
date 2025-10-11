import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BroadcastModule } from './broadcast/broadcast.module';

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
  providers: [AppService],
})
export class AppModule {}

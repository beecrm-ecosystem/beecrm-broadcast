import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { HttpModuleOptions } from '@nestjs/axios/dist/interfaces/http-module.interface';
import { Agent } from 'https';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { PrismaService } from './prisma.service';
import { QueueService } from './services/queue.service';
import { DiogenesService } from './services/diogenes.service';
import { FileParserService } from './services/file-parser.service';
import { ImportService } from './services/import.service';
import { BroadcastProcessor } from './queues/broadcast.processor';
import { ImportContactsProcessor } from './queues/import-contacts.processor';
import { WebhookProcessor } from './queues/webhook.processor';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';
import { WebhookQueueService } from './services/webhook-queue.service';
import { QueueController } from './queue/queue.controller';
import { CampaignWebhookService } from './services/campaign-webhook.service';
import { MetricsService } from './services/metrics.service';
import { MetricsController } from './metrics/metrics.controller';
import { LoggerMiddleware } from './middlewares/logger.middleware';
import { FileLoggerService } from './services/file-logger.service';
import { LogsController } from './logs/logs.controller';
import { LegacyBroadcastController } from './legacy-broadcast.controller';
import { CampaignSchedulerService } from './services/campaign-scheduler.service';
import { CampaignSchedulerProcessor } from './queues/campaign-scheduler.processor';
import { CampaignMonitorService } from './services/campaign-monitor.service';
import { CampaignMonitorProcessor } from './queues/campaign-monitor.processor';
import { WhatsAppDispatcher } from './services/dispatchers/whatsapp.dispatcher';
import { RcsDispatcher } from './services/dispatchers/rcs.dispatcher';
import { ChannelDispatcherFactory } from './services/channel-dispatcher.factory';

@Module({
  imports: [
    // Configuração do BullMQ - Fila de envio de mensagens
    BullModule.registerQueue({
      name: 'broadcast-queue',
    }),
    // Dead-letter queue para falhas definitivas
    BullModule.registerQueue({
      name: 'broadcast-dlq',
    }),
    // Fila responsável por iniciar campanhas agendadas
    BullModule.registerQueue({
      name: 'campaign-scheduler-queue',
    }),
    // Fila de monitoramento de campanhas (job recorrente)
    BullModule.registerQueue({
      name: 'campaign-monitor-queue',
    }),
    // Configuração do BullMQ - Fila de importação de contatos
    BullModule.registerQueue({
      name: 'import-contacts-queue',
    }),
    // Configuração do BullMQ - Fila de processamento de webhooks
    BullModule.registerQueue({
      name: 'webhook-queue',
    }),
    // HTTP para chamadas ao Diogenes e Pontaltech (RCS)
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
      // Keep-alive e conexões paralelas para reduzir latência por envio
      httpAgent: new Agent({ keepAlive: true, maxSockets: 200 }),
      httpsAgent: new Agent({ keepAlive: true, maxSockets: 200 }),
    } as HttpModuleOptions),
  ],
  controllers: [
    BroadcastController,
    LegacyBroadcastController,
    WebhookController,
    QueueController,
    MetricsController,
    LogsController,
  ],
  providers: [
    BroadcastService,
    PrismaService,
    QueueService,
    DiogenesService,
    CampaignWebhookService,
    MetricsService,
    FileParserService,
    ImportService,
    BroadcastProcessor,
    ImportContactsProcessor,
    WebhookProcessor,
    WebhookService,
    WebhookQueueService,
    FileLoggerService,
    CampaignSchedulerService,
    CampaignSchedulerProcessor,
    CampaignMonitorService,
    CampaignMonitorProcessor,
    WhatsAppDispatcher,
    RcsDispatcher,
    ChannelDispatcherFactory,
  ],
  exports: [BroadcastService, QueueService, ImportService, MetricsService, WebhookQueueService],
})
export class BroadcastModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}

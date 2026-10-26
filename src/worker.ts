/* eslint-disable @typescript-eslint/no-misused-promises */
/**
 * Worker-only entry point for BullMQ processors
 * Executa apenas os processors (BroadcastProcessor, etc) sem iniciar o servidor HTTP
 * Permite escalar workers independentemente da API
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { QueueService } from './broadcast/services/queue.service';
import { registerGracefulShutdown } from './shutdown';

async function startWorker() {
  const logger = new Logger('WorkerBootstrap');

  try {
    // Cria aplicação Nest com AppModule para carregar BullModule.forRoot (Redis)
    const app = await NestFactory.create(AppModule.forWorker(), {
      logger: ['log', 'error', 'warn', 'debug'],
    });
    // SIGINT (padrao do PM2) e SIGTERM: fecha os Workers esperando os jobs ativos.
    registerGracefulShutdown(app, logger);

    // Inicializa a aplicação mas não escuta na porta (workers rodam em background)
    await app.init();

    logger.log(`✅ Worker iniciado! Processors em execução:`);
    logger.log(`   - BroadcastProcessor (concurrency: 100)`);
    logger.log(`   - CampaignSchedulerProcessor`);
    logger.log(`   - CampaignMonitorProcessor`);
    logger.log(`   - ImportContactsProcessor`);
    logger.log(`   - WebhookProcessor`);
    logger.log(`   - DlqProcessor (broadcast-dlq)`);
    logger.log(
      `🔗 Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
    );
    logger.log(`🗄️  DB: ${process.env.DATABASE_URL?.split('@')[1] || 'local'}`);

    // BC-04: pausa global deixada no Redis pelo mecanismo antigo nao pode ficar
    // para sempre (nada mais pausa a fila inteira).
    try {
      const { wasPaused } = await app.get(QueueService).resumeIfPaused();
      if (wasPaused) {
        logger.warn('broadcast-queue estava pausada e foi retomada no boot');
      }
    } catch (error) {
      logger.error(
        `Falha ao conferir pausa da broadcast-queue: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } catch (error) {
    logger.error(
      `Erro ao iniciar worker: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

void startWorker();

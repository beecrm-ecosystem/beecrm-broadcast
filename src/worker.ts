/* eslint-disable @typescript-eslint/no-misused-promises */
/**
 * Worker-only entry point for BullMQ processors
 * Executa apenas os processors (BroadcastProcessor, etc) sem iniciar o servidor HTTP
 * Permite escalar workers independentemente da API
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { BroadcastModule } from './broadcast/broadcast.module';

async function startWorker() {
  const logger = new Logger('WorkerBootstrap');

  try {
    // Cria aplicação Nest sem iniciar listener HTTP
    const app = await NestFactory.create(BroadcastModule, {
      logger: ['log', 'error', 'warn', 'debug'],
    });

    // Inicializa a aplicação mas não escuta na porta (workers rodam em background)
    await app.init();

    logger.log(`✅ Worker iniciado! Processors em execução:`);
    logger.log(`   - BroadcastProcessor (concurrency: 100)`);
    logger.log(`   - CampaignSchedulerProcessor`);
    logger.log(`   - CampaignMonitorProcessor`);
    logger.log(`   - ImportContactsProcessor`);
    logger.log(`   - WebhookProcessor`);
    logger.log(`   - DLQ listener`);
    logger.log(
      `🔗 Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
    );
    logger.log(`🗄️  DB: ${process.env.DATABASE_URL?.split('@')[1] || 'local'}`);

    // Keep-alive
    process.on('SIGTERM', async () => {
      logger.log('SIGTERM recebido, encerrando gracefully...');
      await app.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error(
      `Erro ao iniciar worker: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

void startWorker();

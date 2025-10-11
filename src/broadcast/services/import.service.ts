import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FileParserService } from './file-parser.service';
import { ImportContactsJob } from '../queues/import-contacts.processor';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly BATCH_SIZE = 100; // Importa 100 contatos por lote

  constructor(
    @InjectQueue('import-contacts-queue')
    private importContactsQueue: Queue,
    private readonly fileParserService: FileParserService,
  ) {}

  /**
   * Processa arquivo e enfileira importação de contatos
   */
  async importContactsFromFile(
    campaignId: string,
    file: Express.Multer.File,
  ): Promise<{
    totalContacts: number;
    batches: number;
    message: string;
  }> {
    this.logger.log(
      `Iniciando importação de contatos do arquivo ${file.originalname} para campanha ${campaignId}`,
    );

    // Parse do arquivo
    const contacts = await this.fileParserService.parseContactsFile(file);

    if (contacts.length === 0) {
      return {
        totalContacts: 0,
        batches: 0,
        message: 'Nenhum contato válido encontrado no arquivo',
      };
    }

    // Divide contatos em lotes
    const batches = this.chunkArray(contacts, this.BATCH_SIZE);
    const totalBatches = batches.length;

    this.logger.log(`Enfileirando ${contacts.length} contatos em ${totalBatches} lotes`);

    // Enfileira cada lote
    const jobs = batches.map((batch, index) => {
      const jobData: ImportContactsJob = {
        campaignId,
        contacts: batch,
        batchNumber: index + 1,
        totalBatches,
      };

      return {
        name: `import-${campaignId}-batch-${index + 1}`,
        data: jobData,
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential' as const,
            delay: 2000,
          },
          removeOnComplete: {
            age: 3600, // Remove após 1 hora
          },
          removeOnFail: {
            age: 86400, // Remove após 24 horas
          },
        },
      };
    });

    await this.importContactsQueue.addBulk(jobs);

    this.logger.log(`✅ ${contacts.length} contatos enfileirados em ${totalBatches} lotes`);

    return {
      totalContacts: contacts.length,
      batches: totalBatches,
      message: `${contacts.length} contatos enfileirados para importação em ${totalBatches} lotes`,
    };
  }

  /**
   * Divide array em chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Obtém estatísticas da fila de importação
   */
  async getImportQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.importContactsQueue.getWaitingCount(),
      this.importContactsQueue.getActiveCount(),
      this.importContactsQueue.getCompletedCount(),
      this.importContactsQueue.getFailedCount(),
      this.importContactsQueue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }
}

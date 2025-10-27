import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface WebhookLogEntry {
  timestamp: string;
  type: 'meta' | 'meta-message' | 'diogenes';
  messageId: string;
  status: string;
  recipient: string;
  metadata?: any;
  payload?: any;
}

@Injectable()
export class FileLoggerService {
  private readonly logger = new Logger(FileLoggerService.name);
  private readonly logsDir: string;

  constructor() {
    // Diretório de logs na raiz do projeto
    this.logsDir = path.join(process.cwd(), 'logs', 'webhooks');
    this.ensureLogDirectory();
  }

  /**
   * Garante que o diretório de logs existe
   */
  private ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
        this.logger.log(`📁 Diretório de logs criado: ${this.logsDir}`);
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao criar diretório de logs: ${error.message}`);
    }
  }

  /**
   * Registra um webhook em arquivo
   */
  logWebhook(entry: WebhookLogEntry): void {
    try {
      const date = new Date();
      const filename = this.getLogFilename(date);
      const logPath = path.join(this.logsDir, filename);

      const logLine = this.formatLogLine(entry);

      // Adiciona ao arquivo (append)
      fs.appendFileSync(logPath, logLine + '\n', 'utf8');
    } catch (error) {
      this.logger.error(`❌ Erro ao escrever log de webhook: ${error.message}`);
    }
  }

  /**
   * Registra múltiplos webhooks de uma vez
   */
  logWebhooks(entries: WebhookLogEntry[]): void {
    for (const entry of entries) {
      this.logWebhook(entry);
    }
  }

  /**
   * Gera o nome do arquivo de log baseado na data
   * Formato: webhooks-YYYY-MM-DD.log
   */
  private getLogFilename(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `webhooks-${year}-${month}-${day}.log`;
  }

  /**
   * Formata uma linha de log no formato JSON
   */
  private formatLogLine(entry: WebhookLogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp,
      type: entry.type,
      messageId: entry.messageId,
      status: entry.status,
      recipient: entry.recipient,
      metadata: entry.metadata,
      payload: entry.payload,
    });
  }

  /**
   * Limpa logs antigos (opcional)
   * Remove logs com mais de X dias
   */
  cleanOldLogs(daysToKeep: number = 30): void {
    try {
      const files = fs.readdirSync(this.logsDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000; // dias em ms

      let removedCount = 0;

      for (const file of files) {
        if (!file.startsWith('webhooks-') || !file.endsWith('.log')) {
          continue;
        }

        const filePath = path.join(this.logsDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          fs.unlinkSync(filePath);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        this.logger.log(`🗑️ Removidos ${removedCount} arquivos de log antigos`);
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao limpar logs antigos: ${error.message}`);
    }
  }

  /**
   * Obtém estatísticas dos logs
   */
  getLogStats(): {
    totalFiles: number;
    totalSize: number;
    oldestFile: string | null;
    newestFile: string | null;
  } {
    try {
      const files = fs.readdirSync(this.logsDir);
      const logFiles = files.filter((f) => f.startsWith('webhooks-') && f.endsWith('.log'));

      let totalSize = 0;
      let oldestTime = Infinity;
      let newestTime = 0;
      let oldestFile: string | null = null;
      let newestFile: string | null = null;

      for (const file of logFiles) {
        const filePath = path.join(this.logsDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        if (stats.mtimeMs < oldestTime) {
          oldestTime = stats.mtimeMs;
          oldestFile = file;
        }

        if (stats.mtimeMs > newestTime) {
          newestTime = stats.mtimeMs;
          newestFile = file;
        }
      }

      return {
        totalFiles: logFiles.length,
        totalSize,
        oldestFile,
        newestFile,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao obter estatísticas de logs: ${error.message}`);
      return {
        totalFiles: 0,
        totalSize: 0,
        oldestFile: null,
        newestFile: null,
      };
    }
  }
}

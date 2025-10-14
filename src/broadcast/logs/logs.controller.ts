import { Controller, Get, Query, Logger, Delete } from '@nestjs/common';
import { FileLoggerService } from '../services/file-logger.service';

@Controller('logs')
export class LogsController {
  private readonly logger = new Logger(LogsController.name);

  constructor(private readonly fileLoggerService: FileLoggerService) {}

  /**
   * Obtém estatísticas dos logs de webhooks
   */
  @Get('stats')
  getStats() {
    try {
      const stats = this.fileLoggerService.getLogStats();
      return {
        success: true,
        stats: {
          ...stats,
          totalSizeMB: (stats.totalSize / 1024 / 1024).toFixed(2),
        },
      };
    } catch (error) {
      this.logger.error(`Erro ao obter estatísticas: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Limpa logs antigos
   */
  @Delete('cleanup')
  cleanupOldLogs(@Query('days') days?: string) {
    try {
      const daysToKeep = days ? parseInt(days) : 30;

      if (isNaN(daysToKeep) || daysToKeep < 1) {
        return {
          success: false,
          error: 'Parâmetro "days" deve ser um número maior que 0',
        };
      }

      this.fileLoggerService.cleanOldLogs(daysToKeep);

      return {
        success: true,
        message: `Logs com mais de ${daysToKeep} dias foram removidos`,
      };
    } catch (error) {
      this.logger.error(`Erro ao limpar logs: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

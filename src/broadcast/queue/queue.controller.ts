import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { QueueService } from '../services/queue.service';

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get('stats')
  async getQueueStats() {
    return this.queueService.getQueueStats();
  }

  /**
   * Retoma a broadcast-queue se ela ficou pausada (BC-04). Sem @Public(): passa
   * pelo ApiTokenGuard global como as demais rotas da API.
   */
  @Post('resume')
  @HttpCode(200)
  async resumeQueue() {
    return this.queueService.resumeIfPaused();
  }
}

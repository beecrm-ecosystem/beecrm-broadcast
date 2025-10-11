import { Controller, Get } from '@nestjs/common';
import { QueueService } from '../services/queue.service';

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get('stats')
  async getQueueStats() {
    return this.queueService.getQueueStats();
  }
}

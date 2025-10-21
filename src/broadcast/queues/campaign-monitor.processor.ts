import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CampaignMonitorService } from '../services/campaign-monitor.service';

@Processor('campaign-monitor-queue')
export class CampaignMonitorProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignMonitorProcessor.name);

  constructor(private readonly monitorService: CampaignMonitorService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`⏰ Executando job de monitoramento: ${job.name}`);

    try {
      const result = await this.monitorService.monitorRecentCampaigns();

      // A cada execução, limpa o cache de campanhas antigas
      await this.monitorService.cleanupCache();

      return {
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Erro ao executar job de monitoramento: ${error.message}`, error.stack);
      throw error;
    }
  }
}

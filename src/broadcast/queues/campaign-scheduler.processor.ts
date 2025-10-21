import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { BroadcastService } from '../broadcast.service';
import { PrismaService } from '../prisma.service';

interface CampaignSchedulerJobData {
  campaignId: string;
}

@Injectable()
@Processor('campaign-scheduler-queue')
export class CampaignSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignSchedulerProcessor.name);

  constructor(
    private readonly broadcastService: BroadcastService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<CampaignSchedulerJobData>): Promise<any> {
    const { campaignId } = job.data;
    this.logger.log(`Executando agendamento da campanha ${campaignId}`);

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });

    if (!campaign) {
      this.logger.warn(`Campanha ${campaignId} não encontrada. Removendo job.`);
      return { success: false, reason: 'campaign-not-found' };
    }

    if (campaign.deletedAt) {
      this.logger.warn(`Campanha ${campaignId} removida. Ignorando agendamento.`);
      return { success: false, reason: 'campaign-deleted' };
    }

    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      this.logger.log(`Campanha ${campaignId} com status ${campaign.status}. Job ignorado.`);
      return { success: false, reason: 'invalid-status' };
    }

    try {
      await this.broadcastService.startCampaign(campaignId);
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Erro ao iniciar campanha ${campaignId}: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}

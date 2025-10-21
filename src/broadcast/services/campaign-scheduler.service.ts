import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

interface ScheduleJobOptions {
  campaignId: string;
  startAt: Date;
}

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private readonly JOB_PREFIX = 'campaign-start-';

  constructor(@InjectQueue('campaign-scheduler-queue') private readonly schedulerQueue: Queue) {}

  async scheduleCampaign({ campaignId, startAt }: ScheduleJobOptions): Promise<void> {
    const delay = Math.max(startAt.getTime() - Date.now(), 0);
    const jobId = this.getJobId(campaignId);

    await this.removeExistingJob(jobId);

    await this.schedulerQueue.add(
      'start-campaign',
      { campaignId },
      {
        jobId,
        delay,
        removeOnComplete: true,
        attempts: 5,
        backoff: {
          type: 'fixed',
          delay: 5 * 60 * 1000, // 5 minutos
        },
        removeOnFail: {
          age: 12 * 60 * 60, // 12 horas
        },
      },
    );

    this.logger.log(
      `Campanha ${campaignId} agendada para ${startAt.toISOString()} (em ${Math.ceil(delay / 1000)}s)`,
    );
  }

  async cancelScheduledCampaign(campaignId: string): Promise<void> {
    const jobId = this.getJobId(campaignId);
    const job = await this.schedulerQueue.getJob(jobId);

    if (job) {
      try {
        await job.remove();
        this.logger.log(`Agendamento da campanha ${campaignId} removido`);
      } catch (error) {
        this.logger.warn(
          `Não foi possível remover o agendamento da campanha ${campaignId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async removeExistingJob(jobId: string): Promise<void> {
    const job = await this.schedulerQueue.getJob(jobId);

    if (job) {
      try {
        await job.remove();
      } catch (error) {
        this.logger.warn(
          `Não foi possível remover o job existente ${jobId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private getJobId(campaignId: string): string {
    return `${this.JOB_PREFIX}${campaignId}`;
  }
}

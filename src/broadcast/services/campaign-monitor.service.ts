import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { CampaignWebhookService } from './campaign-webhook.service';
import { QueueService } from './queue.service';

interface CampaignChecksum {
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  status: string;
}

@Injectable()
export class CampaignMonitorService implements OnModuleInit {
  private readonly logger = new Logger(CampaignMonitorService.name);
  // Cache de checksums para detectar mudanças
  private readonly checksumCache = new Map<string, string>();

  constructor(
    @InjectQueue('campaign-monitor-queue') private monitorQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly campaignWebhookService: CampaignWebhookService,
    private readonly queueService: QueueService,
  ) {}

  async onModuleInit() {
    // Registra job recorrente ao iniciar o módulo
    await this.scheduleMonitoring();
  }

  /**
   * Agenda job recorrente para monitorar campanhas de 3 em 3 minutos
   */
  async scheduleMonitoring() {
    // Remove jobs antigos se existirem
    const existingJobs = await this.monitorQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      await this.monitorQueue.removeRepeatableByKey(job.key);
    }

    // Adiciona job recorrente: a cada 3 minutos
    await this.monitorQueue.add(
      'monitor-campaigns',
      {},
      {
        repeat: {
          pattern: '*/3 * * * *', // Cron: a cada 3 minutos
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('📅 Job de monitoramento agendado: a cada 3 minutos');
  }

  /**
   * Monitora campanhas criadas nas últimas 8 horas e envia webhooks se houver mudanças
   */
  async monitorRecentCampaigns() {
    const startTime = Date.now();
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);

    this.logger.log(
      `🔍 Iniciando monitoramento de campanhas (desde ${eightHoursAgo.toISOString()})`,
    );

    try {
      // Busca campanhas criadas nas últimas 8 horas (exceto DRAFT e CANCELED)
      const campaigns = await this.prisma.campaign.findMany({
        where: {
          createdAt: {
            gte: eightHoursAgo,
          },
          status: {
            in: ['PROCESSING', 'COMPLETED', 'PAUSED', 'SCHEDULED'],
          },
          deletedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      this.logger.log(`📊 Encontradas ${campaigns.length} campanhas para monitorar`);

      let updatedCount = 0;
      let unchangedCount = 0;

      for (const campaign of campaigns) {
        const hasChanges = await this.checkAndNotifyChanges(campaign);
        if (hasChanges) {
          updatedCount++;
        } else {
          unchangedCount++;
        }
      }

      // Re-enfileira overflow de campanhas com distribuição uniforme
      await this.requeueDistributeEvenlyOverflow();

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Monitoramento concluído em ${duration}ms: ${updatedCount} atualizadas, ${unchangedCount} sem mudanças`,
      );

      return { total: campaigns.length, updated: updatedCount, unchanged: unchangedCount };
    } catch (error) {
      this.logger.error(`Erro ao monitorar campanhas: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Verifica se houve mudanças nos contadores e envia webhook se necessário
   */
  private async checkAndNotifyChanges(campaign: any): Promise<boolean> {
    const currentChecksum = this.generateChecksum(campaign);
    const cachedChecksum = this.checksumCache.get(campaign.id);

    // Se não tem cache ou mudou, envia webhook
    if (!cachedChecksum || cachedChecksum !== currentChecksum) {
      this.logger.log(`📢 Campanha ${campaign.id} (${campaign.name}) mudou - enviando webhook`);
      this.logger.log(
        `   📊 Status: ${campaign.status} | sent=${campaign.sentCount}, delivered=${campaign.deliveredCount}, read=${campaign.readCount}, failed=${campaign.failedCount}`,
      );

      // Atualiza cache
      this.checksumCache.set(campaign.id, currentChecksum);

      // Envia webhooks
      try {
        await this.campaignWebhookService.sendUpdateStatus(campaign);
        await this.campaignWebhookService.sendBroadcastSummary(campaign, {
          status: campaign.status,
          totalContacts: campaign.totalRecipients,
          sentContacts: campaign.sentCount,
          deliveredContacts: campaign.deliveredCount,
          readContacts: campaign.readCount,
          failedContacts: campaign.failedCount,
        });

        return true;
      } catch (error) {
        this.logger.error(`Erro ao enviar webhook para campanha ${campaign.id}: ${error.message}`);
        return false;
      }
    } else {
      this.logger.debug(`⏭️ Campanha ${campaign.id} sem mudanças - ignorando`);
      return false;
    }
  }

  /**
   * Gera checksum (hash) dos dados da campanha para detectar mudanças
   */
  private generateChecksum(campaign: any): string {
    const data: CampaignChecksum = {
      sentCount: campaign.sentCount,
      deliveredCount: campaign.deliveredCount,
      readCount: campaign.readCount,
      failedCount: campaign.failedCount,
      status: campaign.status,
    };

    return JSON.stringify(data);
  }

  /**
   * Verifica campanhas com distributeEvenly=true que ainda têm destinatários PENDING
   * e os re-enfileira se estamos dentro da janela de envio e não há jobs QUEUED.
   */
  private async requeueDistributeEvenlyOverflow() {
    try {
      const campaigns = await this.prisma.campaign.findMany({
        where: {
          status: 'PROCESSING',
          distributeEvenly: true,
        },
      });

      for (const campaign of campaigns) {
        // Conta pendentes ativos
        const pendingCount = await this.prisma.campaignRecipient.count({
          where: { campaignId: campaign.id, status: 'PENDING', isActive: true },
        });
        if (pendingCount === 0) continue;

        // Verifica se estamos dentro da janela de envio
        if (!this.isInsideTimeWindow(campaign)) continue;

        // Verifica se não há jobs QUEUED ativos (evita double-queuing)
        const queuedCount = await this.prisma.campaignRecipient.count({
          where: { campaignId: campaign.id, status: 'QUEUED' },
        });
        if (queuedCount > 0) continue;

        this.logger.log(
          `📊 Re-enfileirando ${pendingCount} destinatários overflow da campanha ${campaign.name} (distribuição uniforme)`,
        );

        await this.queueService.enqueueCampaign(campaign.id, { allowEmpty: true });
      }
    } catch (error) {
      this.logger.error(
        `Erro ao re-enfileirar overflow distribute-evenly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Verifica se o horário atual está dentro da janela de envio da campanha.
   */
  private isInsideTimeWindow(campaign: any): boolean {
    const timeWindows = (campaign.timeWindows as any[]) || [];
    if (timeWindows.length === 0) return true;

    const window = timeWindows[0];
    if (!window?.startTime || !window?.endTime) return true;

    const tz = window.timezone || 'America/Sao_Paulo';
    const now = new Date();
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const currentMinutes = localTime.getHours() * 60 + localTime.getMinutes();

    const [startH, startM] = window.startTime.split(':').map(Number);
    const [endH, endM] = window.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    const isOvernight = endMinutes <= startMinutes;
    if (isOvernight) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * Limpa cache de campanhas antigas (para não crescer infinitamente)
   */
  async cleanupCache() {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);

    // Busca IDs de campanhas ativas recentes
    const recentCampaignIds = await this.prisma.campaign.findMany({
      where: {
        createdAt: {
          gte: eightHoursAgo,
        },
      },
      select: {
        id: true,
      },
    });

    const recentIds = new Set(recentCampaignIds.map((c) => c.id));

    // Remove do cache campanhas que não estão mais no escopo
    let removedCount = 0;
    for (const [campaignId] of this.checksumCache) {
      if (!recentIds.has(campaignId)) {
        this.checksumCache.delete(campaignId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.log(`🧹 Cache limpo: ${removedCount} campanhas antigas removidas`);
    }
  }
}

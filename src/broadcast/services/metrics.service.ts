import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CampaignStatus } from '@prisma/client';

export interface CampaignMetrics {
  campaignId: string;
  name: string;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  pendingCount: number;
  progress: number;
  rates: {
    success: number;
    delivery: number;
    read: number;
    failure: number;
  };
  timestamps: {
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  };
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtém métricas de uma campanha específica
   */
  async getCampaignMetrics(campaignId: string): Promise<CampaignMetrics> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error(`Campanha ${campaignId} não encontrada`);
    }

    return this.buildMetrics(campaign);
  }

  /**
   * Obtém métricas de múltiplas campanhas
   */
  async getBatchMetrics(campaignIds: string[]): Promise<CampaignMetrics[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        id: { in: campaignIds },
        deletedAt: null,
      },
    });

    return campaigns.map((campaign) => this.buildMetrics(campaign));
  }

  /**
   * Obtém métricas de todas as campanhas ativas
   */
  async getActiveCampaignsMetrics(): Promise<CampaignMetrics[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: ['PROCESSING', 'SCHEDULED'] },
        deletedAt: null,
      },
      orderBy: { startedAt: 'desc' },
    });

    return campaigns.map((campaign) => this.buildMetrics(campaign));
  }

  /**
   * Obtém métricas agregadas por canal
   */
  async getMetricsByChannel(channel: string): Promise<{
    channel: string;
    totalCampaigns: number;
    activeCampaigns: number;
    totalMessages: number;
    sentMessages: number;
    failedMessages: number;
    successRate: number;
  }> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { channel, deletedAt: null },
    });

    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter((c) =>
      ['PROCESSING', 'SCHEDULED'].includes(c.status),
    ).length;

    const totalMessages = campaigns.reduce((sum, c) => sum + c.totalRecipients, 0);
    const sentMessages = campaigns.reduce((sum, c) => sum + c.sentCount, 0);
    const failedMessages = campaigns.reduce((sum, c) => sum + c.failedCount, 0);

    const successRate = totalMessages > 0 ? (sentMessages / totalMessages) * 100 : 0;

    return {
      channel,
      totalCampaigns,
      activeCampaigns,
      totalMessages,
      sentMessages,
      failedMessages,
      successRate: Number(successRate.toFixed(2)),
    };
  }

  /**
   * Obtém resumo geral de todas as campanhas
   */
  async getOverallMetrics(): Promise<{
    total: number;
    byStatus: Record<CampaignStatus, number>;
    totalMessages: number;
    sentMessages: number;
    failedMessages: number;
    deliveredMessages: number;
    readMessages: number;
    successRate: number;
    deliveryRate: number;
    readRate: number;
  }> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { deletedAt: null },
    });

    const byStatus = campaigns.reduce(
      (acc, campaign) => {
        acc[campaign.status] = (acc[campaign.status] || 0) + 1;
        return acc;
      },
      {} as Record<CampaignStatus, number>,
    );

    const totalMessages = campaigns.reduce((sum, c) => sum + c.totalRecipients, 0);
    const sentMessages = campaigns.reduce((sum, c) => sum + c.sentCount, 0);
    const failedMessages = campaigns.reduce((sum, c) => sum + c.failedCount, 0);
    const deliveredMessages = campaigns.reduce((sum, c) => sum + c.deliveredCount, 0);
    const readMessages = campaigns.reduce((sum, c) => sum + c.readCount, 0);

    const successRate = totalMessages > 0 ? (sentMessages / totalMessages) * 100 : 0;
    const deliveryRate = sentMessages > 0 ? (deliveredMessages / sentMessages) * 100 : 0;
    const readRate = deliveredMessages > 0 ? (readMessages / deliveredMessages) * 100 : 0;

    return {
      total: campaigns.length,
      byStatus,
      totalMessages,
      sentMessages,
      failedMessages,
      deliveredMessages,
      readMessages,
      successRate: Number(successRate.toFixed(2)),
      deliveryRate: Number(deliveryRate.toFixed(2)),
      readRate: Number(readRate.toFixed(2)),
    };
  }

  /**
   * Constrói objeto de métricas a partir de uma campanha
   */
  private buildMetrics(campaign: any): CampaignMetrics {
    const pendingCount = campaign.totalRecipients - campaign.sentCount - campaign.failedCount;
    const progress =
      campaign.totalRecipients > 0
        ? ((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100
        : 0;

    const successRate =
      campaign.totalRecipients > 0 ? (campaign.sentCount / campaign.totalRecipients) * 100 : 0;

    const deliveryRate =
      campaign.sentCount > 0 ? (campaign.deliveredCount / campaign.sentCount) * 100 : 0;

    const readRate =
      campaign.deliveredCount > 0 ? (campaign.readCount / campaign.deliveredCount) * 100 : 0;

    const failureRate =
      campaign.totalRecipients > 0 ? (campaign.failedCount / campaign.totalRecipients) * 100 : 0;

    return {
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalRecipients: campaign.totalRecipients,
      sentCount: campaign.sentCount,
      deliveredCount: campaign.deliveredCount,
      readCount: campaign.readCount,
      failedCount: campaign.failedCount,
      pendingCount,
      progress: Number(progress.toFixed(2)),
      rates: {
        success: Number(successRate.toFixed(2)),
        delivery: Number(deliveryRate.toFixed(2)),
        read: Number(readRate.toFixed(2)),
        failure: Number(failureRate.toFixed(2)),
      },
      timestamps: {
        createdAt: campaign.createdAt,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
      },
    };
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  responsesCount: number;
  respondedCount: number;
  optOutCount: number;
  pendingCount: number;
  progress: number;
  rates: {
    success: number;
    delivery: number;
    read: number;
    failure: number;
    response: number;
    optOut: number;
  };
  timestamps: {
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    lastResponseAt: Date | null;
  };
  responseTimes: {
    averageSeconds: number;
    averageMinutes: number;
    averageHumanized: string;
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
      throw new NotFoundException(`Campanha ${campaignId} não encontrada`);
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
    responsesCount: number;
    respondedContacts: number;
    optOutCount: number;
    successRate: number;
    responseRate: number;
    optOutRate: number;
    averageResponseTimeSeconds: number;
    averageResponseTimeHumanized: string;
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
    const responsesCount = campaigns.reduce((sum, c) => sum + ((c as any).responsesCount ?? 0), 0);
    const respondedContacts = campaigns.reduce(
      (sum, c) => sum + ((c as any).respondedCount ?? 0),
      0,
    );
    const optOutCount = campaigns.reduce((sum, c) => sum + ((c as any).optOutCount ?? 0), 0);
    const totalResponseTimeSeconds = campaigns.reduce(
      (sum, c) => sum + ((c as any).responseTimeTotalSeconds ?? 0),
      0,
    );

    const successRate = totalMessages > 0 ? (sentMessages / totalMessages) * 100 : 0;
    const responseRate = totalMessages > 0 ? (respondedContacts / totalMessages) * 100 : 0;
    const optOutRate = totalMessages > 0 ? (optOutCount / totalMessages) * 100 : 0;
    const averageResponseTimeSeconds =
      respondedContacts > 0 ? totalResponseTimeSeconds / respondedContacts : 0;

    return {
      channel,
      totalCampaigns,
      activeCampaigns,
      totalMessages,
      sentMessages,
      failedMessages,
      responsesCount,
      respondedContacts,
      optOutCount,
      successRate: Number(successRate.toFixed(2)),
      responseRate: Number(responseRate.toFixed(2)),
      optOutRate: Number(optOutRate.toFixed(2)),
      averageResponseTimeSeconds: Number(averageResponseTimeSeconds.toFixed(2)),
      averageResponseTimeHumanized: this.formatDuration(averageResponseTimeSeconds),
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
    responsesCount: number;
    respondedContacts: number;
    optOutCount: number;
    successRate: number;
    deliveryRate: number;
    readRate: number;
    responseRate: number;
    optOutRate: number;
    averageResponseTimeSeconds: number;
    averageResponseTimeHumanized: string;
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
    const responsesCount = campaigns.reduce((sum, c) => sum + ((c as any).responsesCount ?? 0), 0);
    const respondedContacts = campaigns.reduce(
      (sum, c) => sum + ((c as any).respondedCount ?? 0),
      0,
    );
    const optOutCount = campaigns.reduce((sum, c) => sum + ((c as any).optOutCount ?? 0), 0);
    const totalResponseTimeSeconds = campaigns.reduce(
      (sum, c) => sum + ((c as any).responseTimeTotalSeconds ?? 0),
      0,
    );

    const successRate = totalMessages > 0 ? (sentMessages / totalMessages) * 100 : 0;
    const deliveryRate = sentMessages > 0 ? (deliveredMessages / sentMessages) * 100 : 0;
    const readRate = deliveredMessages > 0 ? (readMessages / deliveredMessages) * 100 : 0;
    const responseRate = totalMessages > 0 ? (respondedContacts / totalMessages) * 100 : 0;
    const optOutRate = totalMessages > 0 ? (optOutCount / totalMessages) * 100 : 0;
    const averageResponseTimeSeconds =
      respondedContacts > 0 ? totalResponseTimeSeconds / respondedContacts : 0;

    return {
      total: campaigns.length,
      byStatus,
      totalMessages,
      sentMessages,
      failedMessages,
      deliveredMessages,
      readMessages,
      responsesCount,
      respondedContacts,
      optOutCount,
      successRate: Number(successRate.toFixed(2)),
      deliveryRate: Number(deliveryRate.toFixed(2)),
      readRate: Number(readRate.toFixed(2)),
      responseRate: Number(responseRate.toFixed(2)),
      optOutRate: Number(optOutRate.toFixed(2)),
      averageResponseTimeSeconds: Number(averageResponseTimeSeconds.toFixed(2)),
      averageResponseTimeHumanized: this.formatDuration(averageResponseTimeSeconds),
    };
  }

  /**
   * Constrói objeto de métricas a partir de uma campanha
   */
  private buildMetrics(campaign: any): CampaignMetrics {
    const pendingCount = campaign.totalRecipients - campaign.sentCount - campaign.failedCount;
    const responsesCount = campaign.responsesCount ?? 0;
    const respondedCount = campaign.respondedCount ?? 0;
    const responseTimeTotalSeconds = campaign.responseTimeTotalSeconds ?? 0;
    const optOutCount = campaign.optOutCount ?? 0;
    const averageResponseSeconds =
      respondedCount > 0 ? responseTimeTotalSeconds / respondedCount : 0;
    const lastResponseAt = campaign.lastResponseAt ?? null;
    const progress =
      campaign.totalRecipients > 0
        ? ((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100
        : 0;

    const successRate =
      campaign.totalRecipients > 0 ? (campaign.sentCount / campaign.totalRecipients) * 100 : 0;

    const deliveryRate =
      campaign.sentCount > 0 ? (campaign.deliveredCount / campaign.sentCount) * 100 : 0;

    const readRate =
      campaign.sentCount > 0
        ? (Math.min(campaign.readCount, campaign.sentCount) / campaign.sentCount) * 100
        : 0;

    const failureRate =
      campaign.totalRecipients > 0 ? (campaign.failedCount / campaign.totalRecipients) * 100 : 0;

    const responseRate =
      campaign.totalRecipients > 0 ? (respondedCount / campaign.totalRecipients) * 100 : 0;
    const optOutRate =
      campaign.totalRecipients > 0 ? (optOutCount / campaign.totalRecipients) * 100 : 0;

    return {
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalRecipients: campaign.totalRecipients,
      sentCount: campaign.sentCount,
      deliveredCount: campaign.deliveredCount,
      readCount: campaign.readCount,
      failedCount: campaign.failedCount,
      responsesCount,
      respondedCount,
      optOutCount,
      pendingCount,
      progress: Number(progress.toFixed(2)),
      rates: {
        success: Number(successRate.toFixed(2)),
        delivery: Number(deliveryRate.toFixed(2)),
        read: Number(readRate.toFixed(2)),
        failure: Number(failureRate.toFixed(2)),
        response: Number(responseRate.toFixed(2)),
        optOut: Number(optOutRate.toFixed(2)),
      },
      timestamps: {
        createdAt: campaign.createdAt,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        lastResponseAt,
      },
      responseTimes: {
        averageSeconds: Number(averageResponseSeconds.toFixed(2)),
        averageMinutes: Number((averageResponseSeconds / 60).toFixed(2)),
        averageHumanized: this.formatDuration(averageResponseSeconds),
      },
    };
  }

  private formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '0s';
    }

    const totalSeconds = Math.round(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const parts: string[] = [];
    if (hours > 0) {
      parts.push(`${hours}h`);
    }
    if (minutes > 0) {
      parts.push(`${minutes}m`);
    }
    if (secs > 0 || parts.length === 0) {
      parts.push(`${secs}s`);
    }

    return parts.join(' ');
  }
}

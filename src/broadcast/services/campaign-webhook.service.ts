import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Campaign, CampaignStatus, MessageStatus } from '@prisma/client';
import { firstValueFrom } from 'rxjs';

interface UpdateStatusOptions {
  status?: CampaignStatus;
  statusCode?: number;
  link?: string;
}

interface BroadcastSummaryOptions {
  status?: CampaignStatus;
  totalContacts?: number;
  sentContacts?: number;
  deliveredContacts?: number;
  readContacts?: number;
  failedContacts?: number;
  pendingContacts?: number;
  error?: string;
  link?: string;
  successMessages?: BroadcastMessageSummary[];
  failedMessages?: BroadcastMessageSummary[];
}

interface BroadcastSummarySnapshot {
  totalContacts: number;
  sentContacts: number;
  deliveredContacts: number;
  readContacts: number;
  failedContacts: number;
}

export interface BroadcastMessageSummary {
  recipientId: string;
  phoneNumber: string;
  status: MessageStatus;
  name?: string | null;
  messageId?: string | null;
  externalId?: string | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  readAt?: Date | string | null;
  failedAt?: Date | string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

@Injectable()
export class CampaignWebhookService {
  private readonly logger = new Logger(CampaignWebhookService.name);
  private readonly endpointPath = '/api/v1/webhooks/campaign-webhook';
  // Cache highest counters per broadcast so follow-up webhooks never regress delivered/read totals.
  private readonly summaryHistory = new Map<string, BroadcastSummarySnapshot>();

  constructor(private readonly httpService: HttpService) {}

  async sendUpdateStatus(campaign: Campaign, options: UpdateStatusOptions = {}): Promise<void> {
    const baseUrl = this.resolveBaseUrl(campaign.channel);
    if (!baseUrl) {
      return;
    }

    const token = this.resolveToken();
    // if (!token) {
    //   this.logger.warn('Token para webhook de campanha não configurado');
    //   return;
    // }

    const resolvedStatus = options.status ?? campaign.status;
    const statusCode = options.statusCode ?? this.mapStatus(resolvedStatus);

    if (typeof statusCode !== 'number') {
      this.logger.warn(`Status desconhecido para campanha ${campaign.id}: ${resolvedStatus}`);
      return;
    }

    const payload: any = {
      event: 'update_status',
      broadcastId: this.resolveBroadcastId(campaign),
      status: statusCode,
    };

    if (options.link) {
      payload.link = options.link;
    }

    this.logger.log(
      `📤 Enviando webhook update_status (campaign=${campaign.id}, status=${resolvedStatus}, code=${statusCode})`,
    );
    this.logger.debug(`Payload do webhook: ${JSON.stringify(payload, null, 2)}`);
    await this.executeRequest(baseUrl, token || '', payload, 'update_status');
  }

  async sendBroadcastSummary(
    campaign: Campaign,
    options: BroadcastSummaryOptions = {},
  ): Promise<void> {
    const baseUrl = this.resolveBaseUrl(campaign.channel);
    if (!baseUrl) {
      return;
    }

    const token = this.resolveToken();
    // if (!token) {
    //   this.logger.warn('Token para webhook de campanha não configurado');
    //   return;
    // }

    // Calcula os valores baseados na campanha ou nas opções
    const resolvedStatus = options.status ?? campaign.status;
    const mappedStatus = this.mapStatus(resolvedStatus);
    const totalContacts = Math.max(options.totalContacts ?? campaign.totalRecipients, 0);
    const sentContactsRaw = options.sentContacts ?? campaign.sentCount;
    const failedContactsRaw = options.failedContacts ?? campaign.failedCount;
    const deliveredContactsRaw = options.deliveredContacts ?? campaign.deliveredCount;
    const readContactsRaw = options.readContacts ?? campaign.readCount;

    const sentContacts = Math.min(Math.max(sentContactsRaw, 0), totalContacts);
    const failedContacts = Math.min(Math.max(failedContactsRaw, 0), totalContacts);
    const deliveredContacts = Math.min(Math.max(deliveredContactsRaw, 0), sentContacts);
    const readContacts = Math.min(Math.max(readContactsRaw, 0), deliveredContacts);

    const broadcastId = this.resolveBroadcastId(campaign);
    const normalizedCounters = this.applySummaryHistory(broadcastId, {
      totalContacts,
      sentContacts,
      deliveredContacts,
      readContacts,
      failedContacts,
    });
    const pendingContacts = Math.max(
      normalizedCounters.totalContacts -
        normalizedCounters.sentContacts -
        normalizedCounters.failedContacts,
      0,
    );

    const payload: any = {
      event: 'broadcast:statusUpdate',
      data: {
        broadcastId,
        details: {
          status: mappedStatus,
          totalContacts: normalizedCounters.totalContacts,
          sentContacts: normalizedCounters.sentContacts,
          deliveredContacts: normalizedCounters.deliveredContacts,
          readContacts: normalizedCounters.readContacts,
          failedContacts: normalizedCounters.failedContacts,
          pendingContacts,
        },
      },
    };

    if (resolvedStatus === CampaignStatus.COMPLETED) {
      payload.data.details.completed = true;
      payload.data.details.completedAt = campaign.completedAt ?? new Date();
    }

    if (options.link) {
      payload.link = options.link;
    }

    if (options.error) {
      payload.data.details.error = options.error;
    }

    if (options.successMessages && options.successMessages.length > 0) {
      payload.data.details.successMessages = options.successMessages;
    }

    if (options.failedMessages && options.failedMessages.length > 0) {
      payload.data.details.failedMessages = options.failedMessages;
    }

    this.logger.log(`Payload do webhook: ${JSON.stringify(payload, null, 2)}`);

    this.logger.log(
      `📤 Enviando webhook broadcast:statusUpdate (campaign=${campaign.id}, status=${resolvedStatus}, code=${mappedStatus})`,
    );
    this.logger.log(
      `   📊 Contadores: sent=${normalizedCounters.sentContacts}, delivered=${normalizedCounters.deliveredContacts}, read=${normalizedCounters.readContacts}, failed=${normalizedCounters.failedContacts}, pending=${pendingContacts}, total=${normalizedCounters.totalContacts}`,
    );
    if (payload.data.details.completed) {
      this.logger.log(
        `✅ Webhook final de campanha disparado (campaign=${campaign.id}, successMessages=${options.successMessages?.length ?? 0}, failedMessages=${options.failedMessages?.length ?? 0})`,
      );
    }
    this.logger.debug(`Payload do webhook: ${JSON.stringify(payload, null, 2)}`);
    await this.executeRequest(baseUrl, token || '', payload, 'broadcast:statusUpdate');
  }

  private async executeRequest(baseUrl: string, token: string, payload: any, eventName: string) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}${this.endpointPath}`;
      await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      this.logger.log(
        `Webhook '${eventName}' enviado para ${url} (broadcastId=${payload.broadcastId ?? payload.data?.broadcastId})`,
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      this.logger.error(`Erro ao enviar webhook '${eventName}': ${status ?? error?.message}`);
      if (data) {
        this.logger.debug(`Payload de erro: ${JSON.stringify(data)}`);
      }
    }
  }

  private resolveBaseUrl(channel?: string): string | null {
    if (!channel) {
      this.logger.warn('Canal não informado para envio do webhook');
      return null;
    }

    const parts = channel.split('-');
    if (parts.length < 2) {
      this.logger.warn(`Formato de canal inválido (${channel}). Esperado: <instancia>-<dominio>.`);
      return null;
    }

    const domain = parts.slice(1).join('-');
    if (!domain) {
      this.logger.warn(`Domínio não encontrado no canal (${channel}).`);
      return null;
    }

    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      return domain.replace(/\/$/, '');
    }

    // Se o domínio contém 'bee.local', usa localhost:9000
    if (domain.includes('bee.local')) {
      return 'http://teste1.bee.local';
    }

    return `https://${domain.replace(/\/$/, '')}`;
  }

  private resolveBroadcastId(campaign: Campaign): string {
    const metadata = campaign.metadata as Record<string, any> | null;
    if (metadata && typeof metadata === 'object' && metadata.externalId) {
      return String(metadata.externalId);
    }
    return campaign.id;
  }

  private resolveToken(): string | null {
    return process.env.CAMPAIGN_WEBHOOK_TOKEN || process.env.BROADCAST_WEBHOOK_TOKEN || null;
  }

  private mapStatus(status?: CampaignStatus): number | undefined {
    if (!status) {
      return undefined;
    }

    const map: Record<CampaignStatus, number> = {
      DRAFT: 0,
      SCHEDULED: 4,
      PROCESSING: 5,
      COMPLETED: 1,
      PAUSED: 3,
      CANCELED: 3,
      FAILED: 6,
    };

    return map[status];
  }

  private applySummaryHistory(
    broadcastId: string,
    counters: BroadcastSummarySnapshot,
  ): BroadcastSummarySnapshot {
    const previous = this.summaryHistory.get(broadcastId);
    const merged: BroadcastSummarySnapshot = {
      totalContacts: counters.totalContacts,
      sentContacts: counters.sentContacts,
      deliveredContacts: counters.deliveredContacts,
      readContacts: counters.readContacts,
      failedContacts: counters.failedContacts,
    };

    if (previous) {
      merged.totalContacts = Math.max(previous.totalContacts, merged.totalContacts);
      merged.sentContacts = Math.max(previous.sentContacts, merged.sentContacts);
      merged.deliveredContacts = Math.max(previous.deliveredContacts, merged.deliveredContacts);
      merged.readContacts = Math.max(previous.readContacts, merged.readContacts);
      merged.failedContacts = Math.max(previous.failedContacts, merged.failedContacts);
    }

    merged.totalContacts = Math.max(merged.totalContacts, 0);
    merged.sentContacts = Math.min(Math.max(merged.sentContacts, 0), merged.totalContacts);
    merged.failedContacts = Math.min(Math.max(merged.failedContacts, 0), merged.totalContacts);
    merged.deliveredContacts = Math.min(merged.deliveredContacts, merged.sentContacts);
    merged.deliveredContacts = Math.max(merged.deliveredContacts, 0);
    merged.readContacts = Math.min(merged.readContacts, merged.deliveredContacts);
    merged.readContacts = Math.max(merged.readContacts, 0);

    this.summaryHistory.set(broadcastId, merged);
    return merged;
  }
}

import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Campaign, CampaignStatus } from '@prisma/client';
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
}

@Injectable()
export class CampaignWebhookService {
  private readonly logger = new Logger(CampaignWebhookService.name);
  private readonly endpointPath = '/api/v1/webhooks/campaign-webhook';

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

    const statusCode = options.statusCode ?? this.mapStatus(options.status ?? campaign.status);

    if (typeof statusCode !== 'number') {
      this.logger.warn(`Status desconhecido para campanha ${campaign.id}: ${campaign.status}`);
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
    const totalContacts = options.totalContacts ?? campaign.totalRecipients;
    const sentContacts = options.sentContacts ?? campaign.sentCount;
    const deliveredContacts = options.deliveredContacts ?? campaign.deliveredCount;
    const readContacts = options.readContacts ?? campaign.readCount;
    const failedContacts = options.failedContacts ?? campaign.failedCount;
    const pendingContacts =
      options.pendingContacts ?? totalContacts - sentContacts - failedContacts;

    const payload: any = {
      event: 'broadcast:statusUpdate',
      data: {
        broadcastId: this.resolveBroadcastId(campaign),
        details: {
          status: this.mapStatus(options.status ?? campaign.status),
          totalContacts,
          sentContacts,
          deliveredContacts,
          readContacts,
          failedContacts,
          pendingContacts,
        },
      },
    };

    if (options.link) {
      payload.link = options.link;
    }

    if (options.error) {
      payload.data.details.error = options.error;
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
}

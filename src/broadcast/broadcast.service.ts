import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QueueService } from './services/queue.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  AddRecipientsDto,
  CampaignStatsDto,
  AddContactsDto,
} from './schemas/broadcast.dto';
import { CampaignStatus } from '@prisma/client';
import { CampaignWebhookService } from './services/campaign-webhook.service';
import { CampaignSchedulerService } from './services/campaign-scheduler.service';

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly campaignWebhook: CampaignWebhookService,
    private readonly campaignScheduler: CampaignSchedulerService,
  ) {}

  /**
   * Cria uma nova campanha
   */
  async createCampaign(dto: CreateCampaignDto) {
    try {
      this.logger.log('===== INICIANDO CRIAÇÃO DE CAMPANHA =====');
      this.logger.log(`Dados recebidos: ${JSON.stringify(dto, null, 2)}`);

      // Valida dados antes de inserir
      if (!dto.name) {
        throw new Error('Nome da campanha é obrigatório');
      }

      if (!dto.channel) {
        this.logger.warn('Canal não informado, usando "whatsapp" como padrão');
      }

      const requestedStartDate = dto.startDate !== undefined ? dto.startDate : dto.scheduledAt;
      const scheduledAt =
        requestedStartDate !== null && requestedStartDate !== undefined
          ? this.ensureFutureScheduledDate(requestedStartDate)
          : null;
      const initialStatus = scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT;

      // Gera templateId se não foi fornecido
      let templateId: string;
      if (dto.templateId) {
        templateId = dto.templateId;
        this.logger.log(`templateId fornecido: ${templateId}`);
      } else if (dto.template && typeof dto.template === 'object' && dto.template.name) {
        // Tenta usar o nome do template
        templateId = String(dto.template.name);
        this.logger.log(`templateId não fornecido, usando template.name: ${templateId}`);
      } else {
        // Gera UUID
        templateId = crypto.randomUUID();
        this.logger.log(`templateId não fornecido, gerado UUID: ${templateId}`);
      }

      this.logger.log('Tentando criar campanha no banco de dados...');

      const campaign = await this.prisma.campaign.create({
        data: {
          name: dto.name,
          description: dto.description,
          templateId,
          templateData: dto.template, // Armazena o template completo em JSON
          channel: dto.channel || 'whatsapp',
          phoneNumberId: dto.phoneNumberId,
          scheduledAt: scheduledAt ?? undefined,
          batchSize: dto.batchSize || 100,
          delayBetweenBatches: dto.delayBetweenBatches || 5000,
          tags: dto.tags || [],
          metadata: dto.metadata,
          status: initialStatus,
        },
      });

      this.logger.log(`✅ Campanha criada com sucesso: ${campaign.id} - ${campaign.name}`);
      this.logger.log(`Enviando webhook de criação...`);

      await this.campaignWebhook.sendUpdateStatus(campaign);

      if (scheduledAt) {
        await this.campaignScheduler.scheduleCampaign({
          campaignId: campaign.id,
          startAt: scheduledAt,
        });
      }

      this.logger.log('===== CAMPANHA CRIADA COM SUCESSO =====');
      return campaign;
    } catch (error) {
      this.logger.error('===== ERRO AO CRIAR CAMPANHA =====');
      this.logger.error(`Tipo do erro: ${error.constructor.name}`);
      this.logger.error(`Mensagem: ${error.message}`);
      this.logger.error(`Stack trace: ${error.stack}`);

      if (error.code) {
        this.logger.error(`Código do erro: ${error.code}`);
      }

      if (error.meta) {
        this.logger.error(`Metadados do erro: ${JSON.stringify(error.meta, null, 2)}`);
      }

      this.logger.error('===== FIM DO ERRO =====');
      throw error;
    }
  }

  /**
   * Lista todas as campanhas com filtros
   */
  async findAll(filters?: {
    status?: CampaignStatus;
    tags?: string[];
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.tags && filters.tags.length > 0) {
      where.tags = {
        hasSome: filters.tags,
      };
    }

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              recipients: true,
              messages: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return {
      data: campaigns,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Busca uma campanha por ID
   */
  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            recipients: true,
            messages: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha ${id} não encontrada`);
    }

    return campaign;
  }

  /**
   * Atualiza uma campanha
   */
  async updateCampaign(id: string, dto: UpdateCampaignDto) {
    const campaign = await this.findOne(id);

    // Valida se pode ser editada
    if (['COMPLETED', 'CANCELED'].includes(campaign.status)) {
      throw new Error('Não é possível editar uma campanha completada ou cancelada');
    }

    const updateData: any = {
      name: dto.name,
      description: dto.description,
      batchSize: dto.batchSize,
      delayBetweenBatches: dto.delayBetweenBatches,
      tags: dto.tags,
      metadata: dto.metadata,
    };

    let shouldSchedule = false;
    let shouldCancelSchedule = false;
    let scheduleDate: Date | null = null;

    if (dto.startDate !== undefined) {
      if (dto.startDate === null) {
        shouldCancelSchedule = true;
      } else {
        scheduleDate = this.ensureFutureScheduledDate(dto.startDate);
        shouldSchedule = true;
      }
    } else if (dto.scheduledAt !== undefined) {
      if (dto.scheduledAt === null) {
        shouldCancelSchedule = true;
      } else {
        scheduleDate = this.ensureFutureScheduledDate(dto.scheduledAt);
        shouldSchedule = true;
      }
    }

    if (shouldSchedule && scheduleDate) {
      if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
        throw new Error('Não é possível agendar uma campanha neste estado.');
      }
      updateData.scheduledAt = scheduleDate;
      updateData.status = CampaignStatus.SCHEDULED;
    } else if (shouldCancelSchedule) {
      updateData.scheduledAt = null;
      if (campaign.status === 'SCHEDULED') {
        updateData.status = CampaignStatus.DRAFT;
      }
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Campanha atualizada: ${id}`);

    if (shouldSchedule && scheduleDate) {
      await this.campaignScheduler.scheduleCampaign({ campaignId: id, startAt: scheduleDate });
    } else if (shouldCancelSchedule) {
      await this.campaignScheduler.cancelScheduledCampaign(id);
    }

    return updated;
  }

  /**
   * Adiciona destinatários a uma campanha
   */
  async addRecipients(campaignId: string, dto: AddRecipientsDto) {
    await this.findOne(campaignId);

    const result = await this.prisma.campaignRecipient.createMany({
      data: dto.recipients.map((recipient) => ({
        campaignId,
        phoneNumber: recipient.phoneNumber,
        name: recipient.name,
        email: recipient.email,
        variables: recipient.variables || {},
        metadata: recipient.metadata,
      })),
      skipDuplicates: true,
    });

    const updatedCampaign = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        totalRecipients: {
          increment: result.count,
        },
      },
    });

    this.logger.log(`${result.count} destinatários adicionados à campanha ${campaignId}`);

    await this.campaignWebhook.sendBroadcastSummary(updatedCampaign, {
      status: updatedCampaign.status,
      totalContacts: updatedCampaign.totalRecipients,
      failedContacts: updatedCampaign.failedCount,
    });

    return {
      count: result.count,
      message: `${result.count} destinatários adicionados com sucesso`,
    };
  }

  /**
   * Adiciona destinatários usando o formato legado de contacts
   */
  async addContacts(campaignId: string, dto: AddContactsDto) {
    if (!dto.contacts || dto.contacts.length === 0) {
      throw new Error('Nenhum contato informado');
    }

    const recipients: AddRecipientsDto = {
      recipients: dto.contacts.map((contact) => ({
        phoneNumber: contact.phone,
        name: contact.name,
        email: contact.email,
        variables: this.sanitizeVariables(contact.variables),
        metadata: contact.metadata,
      })),
    };

    return this.addRecipients(campaignId, recipients);
  }

  /**
   * Obtém os destinatários de uma campanha
   */
  async getRecipients(campaignId: string, page: number = 1, limit: number = 50) {
    await this.findOne(campaignId);

    const skip = (page - 1) * limit;

    const [recipients, total] = await Promise.all([
      this.prisma.campaignRecipient.findMany({
        where: { campaignId, isActive: true },
        skip,
        take: limit,
        include: {
          messages: {
            select: {
              id: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
            },
          },
        },
      }),
      this.prisma.campaignRecipient.count({
        where: { campaignId, isActive: true },
      }),
    ]);

    return {
      data: recipients,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Inicia uma campanha e enfileira os destinatários
   */
  async startCampaign(id: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new Error('Apenas campanhas em rascunho ou agendadas podem ser iniciadas');
    }

    if (campaign.totalRecipients === 0) {
      throw new Error('A campanha não possui destinatários');
    }

    await this.campaignScheduler.cancelScheduledCampaign(id);

    // Atualiza status para PROCESSING
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
      },
    });

    await this.campaignWebhook.sendUpdateStatus(updated);

    // Enfileira todos os destinatários
    const queueResult = await this.queueService.enqueueCampaign(id);

    this.logger.log(
      `Campanha iniciada: ${id} - ${queueResult.totalEnqueued} mensagens enfileiradas`,
    );

    return {
      ...updated,
      queue: queueResult,
    };
  }

  /**
   * Pausa uma campanha
   */
  async pauseCampaign(id: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== 'PROCESSING') {
      throw new Error('Apenas campanhas em processamento podem ser pausadas');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED' },
    });

    this.logger.log(`Campanha pausada: ${id}`);
    await this.campaignWebhook.sendUpdateStatus(updated);

    return updated;
  }

  /**
   * Retoma uma campanha pausada
   */
  async resumeCampaign(id: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== 'PAUSED') {
      throw new Error('Apenas campanhas pausadas podem ser retomadas');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'PROCESSING' },
    });

    this.logger.log(`Campanha retomada: ${id}`);
    await this.campaignWebhook.sendUpdateStatus(updated);

    return updated;
  }

  /**
   * Cancela uma campanha
   */
  async cancelCampaign(id: string) {
    const campaign = await this.findOne(id);

    if (['COMPLETED', 'CANCELED'].includes(campaign.status)) {
      throw new Error('Esta campanha já foi finalizada');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        status: 'CANCELED',
        completedAt: new Date(),
      },
    });

    this.logger.log(`Campanha cancelada: ${id}`);
    await this.campaignWebhook.sendUpdateStatus(updated);
    await this.campaignWebhook.sendBroadcastSummary(updated, {
      status: 'CANCELED',
      totalContacts: updated.sentCount,
      failedContacts: updated.failedCount,
    });

    return updated;
  }

  /**
   * Remove uma campanha (soft delete)
   */
  async deleteCampaign(id: string) {
    await this.findOne(id);

    const deleted = await this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Campanha removida: ${id}`);
    await this.campaignWebhook.sendUpdateStatus(deleted, { statusCode: 7 });

    return { message: 'Campanha removida com sucesso' };
  }

  /**
   * Obtém estatísticas de uma campanha
   */
  async getCampaignStats(id: string): Promise<CampaignStatsDto> {
    const campaign = await this.findOne(id);

    const pending = campaign.totalRecipients - campaign.sentCount - campaign.failedCount;

    // Taxa de entrega: mensagens entregues / mensagens enviadas com sucesso
    const deliveryRate =
      campaign.sentCount > 0
        ? ((campaign.deliveredCount / campaign.sentCount) * 100).toFixed(2)
        : '0.00';

    // Taxa de leitura: mensagens lidas / mensagens entregues
    const readRate =
      campaign.deliveredCount > 0
        ? ((campaign.readCount / campaign.deliveredCount) * 100).toFixed(2)
        : '0.00';

    // Taxa de falha: mensagens falhadas / total de tentativas
    const failureRate =
      campaign.totalRecipients > 0
        ? ((campaign.failedCount / campaign.totalRecipients) * 100).toFixed(2)
        : '0.00';

    // Taxa de sucesso: mensagens enviadas / total de tentativas
    const successRate =
      campaign.totalRecipients > 0
        ? ((campaign.sentCount / campaign.totalRecipients) * 100).toFixed(2)
        : '0.00';

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
      },
      stats: {
        totalRecipients: campaign.totalRecipients,
        sent: campaign.sentCount,
        delivered: campaign.deliveredCount,
        read: campaign.readCount,
        failed: campaign.failedCount,
        pending,
      },
      rates: {
        success: `${successRate}%`,
        delivery: `${deliveryRate}%`,
        read: `${readRate}%`,
        failure: `${failureRate}%`,
      },
    };
  }

  private ensureFutureScheduledDate(rawDate: string | Date): Date {
    const parsedDate = rawDate instanceof Date ? rawDate : new Date(rawDate);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error('Data de início inválida. Use um formato ISO 8601.');
    }

    if (parsedDate.getTime() <= Date.now()) {
      throw new Error('A data de início deve estar no futuro.');
    }

    return parsedDate;
  }

  private sanitizeVariables(variables?: Record<string, any>): Record<string, string> | undefined {
    if (!variables || typeof variables !== 'object') {
      return undefined;
    }

    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(variables)) {
      if (value === null || value === undefined) {
        continue;
      }

      sanitized[key] = String(value);
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }
}

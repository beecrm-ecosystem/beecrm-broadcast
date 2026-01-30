import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BroadcastService } from './broadcast.service';
import { ImportService } from './services/import.service';
import { CampaignMonitorService } from './services/campaign-monitor.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  AddRecipientsDto,
  CampaignFilterDto,
  AddContactsDto,
  TriggerBroadcastUpdateDto,
} from './schemas/broadcast.dto';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

const validationErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'number', example: 400 },
    message: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
};

const notFoundErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'number', example: 404 },
    message: { type: 'string' },
    error: { type: 'string', example: 'Not Found' },
  },
};

const internalServerErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'number', example: 500 },
    message: { type: 'string', example: 'Internal server error' },
    error: { type: 'string', example: 'Internal Server Error' },
  },
};

const campaignBaseProperties = {
  id: { type: 'string', example: 'cmp_123456' },
  name: { type: 'string', example: 'Campanha Black Friday' },
  description: { type: 'string', nullable: true, example: 'Campanha promocional de novembro' },
  status: {
    type: 'string',
    example: 'DRAFT',
    enum: ['DRAFT', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'PAUSED', 'CANCELED', 'FAILED'],
  },
  templateId: { type: 'string', example: 'promo_template_v1' },
  templateData: {
    type: 'object',
    example: {
      name: 'promo_template_v1',
      language: 'pt_BR',
      components: [{ type: 'BODY', text: 'Olá {{1}}, confira nossa promoção!' }],
    },
  },
  channel: { type: 'string', example: 'whatsapp' },
  phoneNumberId: { type: 'string', nullable: true, example: '1234567890' },
  scheduledAt: {
    type: 'string',
    format: 'date-time',
    nullable: true,
    example: '2025-11-24T12:00:00.000Z',
  },
  startedAt: { type: 'string', format: 'date-time', nullable: true },
  completedAt: { type: 'string', format: 'date-time', nullable: true },
  batchSize: { type: 'number', example: 100 },
  delayBetweenBatches: { type: 'number', example: 5000, description: 'Delay em ms entre lotes' },
  tags: { type: 'array', items: { type: 'string' }, example: ['vip', 'black-friday'] },
  metadata: {
    type: 'object',
    nullable: true,
    example: { origin: 'crm', segment: 'clientes_ativos' },
  },
  totalRecipients: { type: 'number', example: 5000 },
  sentCount: { type: 'number', example: 3200 },
  deliveredCount: { type: 'number', example: 3000 },
  readCount: { type: 'number', example: 2500 },
  failedCount: { type: 'number', example: 150 },
  responsesCount: { type: 'number', example: 420 },
  respondedCount: { type: 'number', example: 310 },
  responseTimeTotalSeconds: { type: 'number', example: 15400 },
  optOutCount: { type: 'number', example: 20 },
  lastResponseAt: { type: 'string', format: 'date-time', nullable: true },
  deletedAt: { type: 'string', format: 'date-time', nullable: true },
  createdAt: { type: 'string', format: 'date-time', example: '2025-10-01T10:00:00.000Z' },
  updatedAt: { type: 'string', format: 'date-time', example: '2025-10-01T12:30:00.000Z' },
};

const campaignSchema = {
  type: 'object',
  properties: campaignBaseProperties,
};

const campaignCountSchema = {
  type: 'object',
  properties: {
    recipients: { type: 'number', example: 3500 },
    messages: { type: 'number', example: 3400 },
  },
};

const campaignWithCountsSchema = {
  type: 'object',
  properties: {
    ...campaignBaseProperties,
    _count: campaignCountSchema,
  },
};

const paginationMetaSchema = {
  type: 'object',
  properties: {
    total: { type: 'number', example: 120 },
    page: { type: 'number', example: 1 },
    limit: { type: 'number', example: 10 },
    totalPages: { type: 'number', example: 12 },
  },
};

const campaignListResponseSchema = {
  type: 'object',
  properties: {
    data: { type: 'array', items: campaignWithCountsSchema },
    meta: paginationMetaSchema,
  },
};

const monitorRunResponseSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', example: 'Monitoramento executado com sucesso' },
    timestamp: { type: 'string', format: 'date-time', example: '2025-10-08T12:00:00.000Z' },
    total: { type: 'number', example: 12 },
    updated: { type: 'number', example: 3 },
    unchanged: { type: 'number', example: 9 },
  },
};

const recipientMessageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'msg_123' },
    status: {
      type: 'string',
      example: 'SENT',
      enum: ['PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'REJECTED'],
    },
    sentAt: { type: 'string', format: 'date-time', nullable: true },
    deliveredAt: { type: 'string', format: 'date-time', nullable: true },
    readAt: { type: 'string', format: 'date-time', nullable: true },
    failedAt: { type: 'string', format: 'date-time', nullable: true },
    errorCode: { type: 'string', nullable: true },
    errorMessage: { type: 'string', nullable: true },
    errorDetails: { type: 'object', nullable: true },
  },
};

const campaignRecipientSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'recp_123' },
    campaignId: { type: 'string', example: 'cmp_123456' },
    phoneNumber: { type: 'string', example: '5511999999999' },
    name: { type: 'string', nullable: true, example: 'Maria Silva' },
    email: { type: 'string', nullable: true, example: 'maria@example.com' },
    status: {
      type: 'string',
      example: 'SENT',
      enum: ['PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'REJECTED'],
    },
    sentAt: { type: 'string', format: 'date-time', nullable: true },
    deliveredAt: { type: 'string', format: 'date-time', nullable: true },
    readAt: { type: 'string', format: 'date-time', nullable: true },
    respondedAt: { type: 'string', format: 'date-time', nullable: true },
    lastResponseAt: { type: 'string', format: 'date-time', nullable: true },
    responseCount: { type: 'number', example: 2 },
    variables: {
      type: 'object',
      nullable: true,
      example: { 1: 'Maria', plan: 'premium' },
    },
    metadata: {
      type: 'object',
      nullable: true,
      example: { region: 'sudeste' },
    },
    messages: {
      type: 'array',
      description: 'Histórico de mensagens enviadas para o destinatário',
      items: recipientMessageSchema,
    },
  },
};

const recipientsListResponseSchema = {
  type: 'object',
  properties: {
    data: { type: 'array', items: campaignRecipientSchema },
    meta: paginationMetaSchema,
  },
};

const addRecipientsResponseSchema = {
  type: 'object',
  properties: {
    count: { type: 'number', example: 150 },
    message: { type: 'string', example: '150 destinatários adicionados com sucesso' },
  },
};

const queueSummarySchema = {
  type: 'object',
  properties: {
    totalEnqueued: { type: 'number', example: 500 },
    batches: { type: 'number', example: 5 },
    batchSize: { type: 'number', example: 100 },
    delayBetweenBatches: { type: 'number', example: 5000 },
  },
};

const startCampaignResponseSchema = {
  type: 'object',
  properties: {
    ...campaignBaseProperties,
    queue: queueSummarySchema,
  },
};

const importFileResponseSchema = {
  type: 'object',
  properties: {
    totalContacts: { type: 'number', example: 1200 },
    batches: { type: 'number', example: 12 },
    message: {
      type: 'string',
      example: '1200 contatos enfileirados para importação em 12 lotes',
    },
  },
};

const simpleMessageResponseSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', example: 'Campanha removida com sucesso' },
  },
};

const campaignStatsSchema = {
  type: 'object',
  properties: {
    campaign: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'cmp_123456' },
        name: { type: 'string', example: 'Campanha Black Friday' },
        status: { type: 'string', example: 'PROCESSING' },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    stats: {
      type: 'object',
      properties: {
        totalRecipients: { type: 'number', example: 5000 },
        sent: { type: 'number', example: 4200 },
        delivered: { type: 'number', example: 4100 },
        read: { type: 'number', example: 3600 },
        failed: { type: 'number', example: 150 },
        pending: { type: 'number', example: 650 },
        responded: { type: 'number', example: 480 },
        optedOut: { type: 'number', example: 25 },
      },
    },
    rates: {
      type: 'object',
      properties: {
        success: { type: 'string', example: '84.00%' },
        delivery: { type: 'string', example: '97.62%' },
        read: { type: 'string', example: '87.80%' },
        failure: { type: 'string', example: '3.00%' },
        response: { type: 'string', example: '9.60%' },
        optOut: { type: 'string', example: '0.50%' },
      },
    },
    responseTimes: {
      type: 'object',
      properties: {
        averageSeconds: { type: 'number', example: 120.5 },
        averageMinutes: { type: 'number', example: 2.01 },
        averageHumanized: { type: 'string', example: '2m 1s' },
      },
    },
    engagement: {
      type: 'object',
      properties: {
        buttonClicks: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 120 },
            uniqueContacts: { type: 'number', example: 95 },
            rate: { type: 'string', example: '2.30%' },
          },
        },
        hourlyDistribution: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              hour: { type: 'number', example: 14 },
              responses: { type: 'number', example: 25 },
              reads: { type: 'number', example: 180 },
              engagementScore: { type: 'number', example: 205 },
            },
          },
        },
        bestHours: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              hour: { type: 'number', example: 19 },
              responses: { type: 'number', example: 40 },
              reads: { type: 'number', example: 210 },
              engagementScore: { type: 'number', example: 250 },
            },
          },
        },
      },
    },
  },
};

const recipientInputSchema = {
  type: 'object',
  properties: {
    phoneNumber: { type: 'string', example: '5511999999999' },
    name: { type: 'string', nullable: true, example: 'Maria Silva' },
    email: { type: 'string', nullable: true, example: 'maria@example.com' },
    variables: {
      type: 'object',
      nullable: true,
      example: { 1: 'Maria', plan: 'premium', dueDate: '2025-10-30' },
    },
    metadata: {
      type: 'object',
      nullable: true,
      example: { tags: ['vip'] },
    },
  },
  required: ['phoneNumber'],
};

const addRecipientsBodySchema = {
  type: 'object',
  required: ['recipients'],
  properties: {
    recipients: {
      type: 'array',
      minItems: 1,
      items: recipientInputSchema,
    },
  },
};

const addContactsBodySchema = {
  type: 'object',
  required: ['contacts'],
  properties: {
    contacts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          phone: { type: 'string', example: '5511888888888' },
          name: { type: 'string', nullable: true, example: 'João Souza' },
          email: { type: 'string', nullable: true, example: 'joao@example.com' },
          variables: {
            type: 'object',
            nullable: true,
            example: { plan: 'gold', city: 'São Paulo' },
          },
          metadata: {
            type: 'object',
            nullable: true,
            example: { source: 'legacy-system' },
          },
        },
        required: ['phone'],
      },
    },
    contacts_count: {
      type: 'number',
      nullable: true,
      example: 250,
      description: 'Quantidade de contatos que serão processados (opcional)',
    },
  },
};

const createCampaignBodySchema = {
  type: 'object',
  required: ['name', 'template'],
  properties: {
    name: { type: 'string', example: 'Campanha de Boas-vindas' },
    description: {
      type: 'string',
      nullable: true,
      example: 'Mensagem enviada para novos clientes nas primeiras 24h',
    },
    templateId: {
      type: 'string',
      nullable: true,
      example: 'welcome_template_v2',
      description: 'Identificador do template aprovado no WhatsApp. Será gerado se omitido.',
    },
    template: {
      type: 'object',
      example: {
        name: 'welcome_template_v2',
        language: 'pt_BR',
        components: [
          { type: 'HEADER', text: 'Bem-vindo!' },
          { type: 'BODY', text: 'Olá {{1}}, obrigado por se cadastrar.' },
        ],
      },
      description: 'Estrutura completa do template aprovado no WhatsApp Business API',
    },
    channel: {
      type: 'string',
      nullable: true,
      example: 'whatsapp',
      description: 'Canal em que a campanha será disparada',
    },
    phoneNumberId: {
      type: 'string',
      nullable: true,
      example: '123456789',
      description: 'Identificador do número no WhatsApp Business',
    },
    startDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2025-10-26T12:00:00.000Z',
      description: 'Data opcional para início do envio. Deve estar no futuro.',
    },
    scheduledAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2025-10-26T12:00:00.000Z',
      description: 'Alternativa ao startDate para agendamento.',
    },
    batchSize: {
      type: 'number',
      nullable: true,
      example: 100,
      description: 'Quantidade de mensagens enviadas por lote (1-1000).',
    },
    delayBetweenBatches: {
      type: 'number',
      nullable: true,
      example: 5000,
      description: 'Delay em milissegundos entre os lotes (mínimo 1000).',
    },
    tags: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
      example: ['onboarding', 'automação'],
    },
    metadata: {
      type: 'object',
      nullable: true,
      example: { origin: 'crm', priority: 'high' },
    },
  },
};

const updateCampaignBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', example: 'Campanha de Boas-vindas - Revisada' },
    description: {
      type: 'string',
      nullable: true,
      example: 'Fluxo revisado com novas mensagens',
    },
    startDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2025-11-01T10:00:00.000Z',
    },
    scheduledAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      example: '2025-11-01T10:00:00.000Z',
    },
    batchSize: { type: 'number', nullable: true, example: 150 },
    delayBetweenBatches: { type: 'number', nullable: true, example: 6000 },
    tags: { type: 'array', nullable: true, items: { type: 'string' } },
    metadata: {
      type: 'object',
      nullable: true,
      example: { origin: 'crm', priority: 'medium' },
    },
  },
};

@ApiTags('Broadcast')
@Controller('broadcast')
export class BroadcastController {
  private readonly logger = new Logger(BroadcastController.name);

  constructor(
    private readonly broadcastService: BroadcastService,
    private readonly importService: ImportService,
    private readonly monitorService: CampaignMonitorService,
  ) {}

  /**
   * POST /broadcast/monitor/run
   * Executa o monitoramento de campanhas manualmente (útil para testes)
   */
  @Post('monitor/run')
  @ApiOperation({ summary: 'Executa o monitoramento manual das campanhas' })
  @ApiResponse({
    status: 200,
    description: 'Monitoramento executado com sucesso',
    schema: monitorRunResponseSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao executar o monitoramento',
    schema: internalServerErrorSchema,
  })
  async runMonitor() {
    const result = await this.monitorService.monitorRecentCampaigns();
    return {
      message: 'Monitoramento executado com sucesso',
      timestamp: new Date().toISOString(),
      ...result,
    };
  }

  /**
   * POST /broadcast/:id/webhooks/status-update
   * Dispara manualmente um webhook broadcast:statusUpdate (e opcionalmente update_status)
   */
  @Post(':id/webhooks/status-update')
  @ApiOperation({ summary: 'Dispara manualmente um webhook de status da campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiBody({
    description: 'Campos opcionais para sobrescrever status e contadores enviados ao CRM',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['DRAFT', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'PAUSED', 'CANCELED', 'FAILED'],
          example: 'COMPLETED',
        },
        sendStatusEvent: {
          type: 'boolean',
          example: true,
          description: 'Quando verdadeiro, também envia o webhook update_status',
        },
        totalContacts: { type: 'number', example: 1000 },
        sentContacts: { type: 'number', example: 1000 },
        deliveredContacts: { type: 'number', example: 950 },
        readContacts: { type: 'number', example: 600 },
        failedContacts: { type: 'number', example: 50 },
        statusCode: { type: 'number', example: 1 },
        link: {
          type: 'string',
          example: 'https://crm.exemplo.com/campaign/123',
        },
        error: {
          type: 'string',
          example: 'Mensagem customizada enviada manualmente',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook disparado com sucesso',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Webhooks de campanha disparados com sucesso',
        },
        status: {
          type: 'string',
          example: 'COMPLETED',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro ao disparar o webhook manual',
    schema: internalServerErrorSchema,
  })
  async triggerStatusUpdate(@Param('id') id: string, @Body() payload: TriggerBroadcastUpdateDto) {
    return this.broadcastService.triggerBroadcastUpdate(id, payload);
  }

  /**
   * POST /broadcast
   * Cria uma nova campanha
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria uma nova campanha' })
  @ApiBody({
    description: 'Payload necessário para criar uma campanha de broadcast',
    schema: createCampaignBodySchema,
  })
  @ApiResponse({
    status: 201,
    description: 'Campanha criada com sucesso',
    schema: campaignSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação ao criar campanha',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao criar campanha',
    schema: internalServerErrorSchema,
  })
  async create(@Body() createCampaignDto: CreateCampaignDto) {
    try {
      this.logger.log('===== REQUISIÇÃO RECEBIDA NO CONTROLLER =====');
      this.logger.log(`Método: POST /broadcast`);
      this.logger.log(`Body recebido: ${JSON.stringify(createCampaignDto, null, 2)}`);
      this.logger.log(`Tipo do DTO: ${typeof createCampaignDto}`);
      this.logger.log(`Campos recebidos: ${Object.keys(createCampaignDto).join(', ')}`);

      const result = await this.broadcastService.createCampaign(createCampaignDto);

      this.logger.log('===== RESPOSTA ENVIADA COM SUCESSO =====');
      return result;
    } catch (error) {
      this.logger.error('===== ERRO NO CONTROLLER =====');
      this.logger.error(`Erro: ${error.message}`);
      this.logger.error(`Stack: ${error.stack}`);
      throw error;
    }
  }

  /**
   * GET /broadcast
   * Lista todas as campanhas com filtros
   */
  @Get()
  @ApiOperation({ summary: 'Lista campanhas com filtros opcionais' })
  @ApiQuery({ name: 'status', required: false, description: 'Filtra por status da campanha' })
  @ApiQuery({
    name: 'tags',
    required: false,
    description: 'Filtra por tags da campanha',
    type: [String],
  })
  @ApiQuery({ name: 'page', required: false, description: 'Página para paginação', type: Number })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Quantidade de itens por página',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de campanhas retornada com sucesso',
    schema: campaignListResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Parâmetros de filtro inválidos',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao listar campanhas',
    schema: internalServerErrorSchema,
  })
  async findAll(@Query() filters: CampaignFilterDto) {
    return this.broadcastService.findAll(filters);
  }

  /**
   * GET /broadcast/:id
   * Busca uma campanha específica
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtém detalhes de uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha encontrada',
    schema: campaignWithCountsSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao buscar campanha',
    schema: internalServerErrorSchema,
  })
  async findOne(@Param('id') id: string) {
    return this.broadcastService.findOne(id);
  }

  /**
   * PUT /broadcast/:id
   * Atualiza uma campanha
   */
  @Put(':id')
  @ApiOperation({ summary: 'Atualiza os dados de uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiBody({
    description: 'Campos que podem ser alterados em uma campanha existente',
    schema: updateCampaignBodySchema,
  })
  @ApiResponse({
    status: 200,
    description: 'Campanha atualizada com sucesso',
    schema: campaignSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação ao atualizar campanha',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao atualizar campanha',
    schema: internalServerErrorSchema,
  })
  async update(@Param('id') id: string, @Body() updateCampaignDto: UpdateCampaignDto) {
    return this.broadcastService.updateCampaign(id, updateCampaignDto);
  }

  /**
   * DELETE /broadcast/:id
   * Remove uma campanha (soft delete)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove uma campanha (soft delete)' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha marcada como removida',
    schema: simpleMessageResponseSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao remover campanha',
    schema: internalServerErrorSchema,
  })
  async remove(@Param('id') id: string) {
    return this.broadcastService.deleteCampaign(id);
  }

  /**
   * POST /broadcast/:id/recipients
   * Adiciona destinatários a uma campanha via JSON
   */
  @Post(':id/recipients')
  @ApiOperation({ summary: 'Adiciona destinatários a uma campanha via JSON' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiBody({
    description: 'Lista de destinatários que serão anexados à campanha',
    schema: addRecipientsBodySchema,
  })
  @ApiResponse({
    status: 200,
    description: 'Destinatários adicionados com sucesso',
    schema: addRecipientsResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação ao adicionar destinatários',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao adicionar destinatários',
    schema: internalServerErrorSchema,
  })
  async addRecipients(@Param('id') id: string, @Body() addRecipientsDto: AddRecipientsDto) {
    return this.broadcastService.addRecipients(id, addRecipientsDto);
  }

  /**
   * POST /broadcast/:id/contacts
   * Alias legacy para adicionar destinatários usando o formato "contacts"
   */
  @Post(':id/contacts')
  @ApiOperation({ summary: 'Adiciona destinatários usando o formato legado de contacts' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiBody({
    description: 'Formato legado de contatos aceito pelo importador',
    schema: addContactsBodySchema,
  })
  @ApiResponse({
    status: 200,
    description: 'Contatos adicionados com sucesso',
    schema: addRecipientsResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação ao adicionar contatos',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao adicionar contatos',
    schema: internalServerErrorSchema,
  })
  async addContacts(@Param('id') id: string, @Body() addContactsDto: AddContactsDto) {
    return this.broadcastService.addContacts(id, addContactsDto);
  }

  /**
   * POST /broadcast/:id/recipients/upload
   * Adiciona destinatários via upload de arquivo CSV/XLSX
   */
  @Post(':id/recipients/upload')
  @ApiOperation({ summary: 'Importa destinatários por meio de arquivo CSV ou XLSX' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Arquivo contendo os destinatários a serem importados',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Importação iniciada com sucesso',
    schema: importFileResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro ao validar o arquivo enviado',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao importar destinatários',
    schema: internalServerErrorSchema,
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
      fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

        if (
          allowedMimeTypes.includes(file.mimetype) ||
          (fileExtension && allowedExtensions.includes(fileExtension))
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Formato de arquivo inválido. Use CSV ou XLSX'), false);
        }
      },
    }),
  )
  async uploadRecipients(
    @Param('id') campaignId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado');
    }

    return this.importService.importContactsFromFile(campaignId, file);
  }

  /**
   * GET /broadcast/:id/recipients
   * Lista os destinatários de uma campanha
   */
  @Get(':id/recipients')
  @ApiOperation({ summary: 'Lista os destinatários ativos de uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiQuery({ name: 'page', required: false, description: 'Página de resultados', type: Number })
  @ApiQuery({ name: 'limit', required: false, description: 'Quantidade por página', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Destinatários retornados com sucesso',
    schema: recipientsListResponseSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao listar destinatários',
    schema: internalServerErrorSchema,
  })
  async getRecipients(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.broadcastService.getRecipients(id, page, limit);
  }

  /**
   * POST /broadcast/:id/start
   * Inicia uma campanha
   */
  @Post(':id/start')
  @ApiOperation({ summary: 'Inicia o envio de uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha iniciada com sucesso',
    schema: startCampaignResponseSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao iniciar campanha',
    schema: internalServerErrorSchema,
  })
  async start(@Param('id') id: string) {
    return this.broadcastService.startCampaign(id);
  }

  /**
   * POST /broadcast/:id/pause
   * Pausa uma campanha
   */
  @Post(':id/pause')
  @ApiOperation({ summary: 'Pausa uma campanha em processamento' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha pausada com sucesso',
    schema: campaignSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao pausar campanha',
    schema: internalServerErrorSchema,
  })
  async pause(@Param('id') id: string) {
    return this.broadcastService.pauseCampaign(id);
  }

  /**
   * POST /broadcast/:id/resume
   * Retoma uma campanha pausada
   */
  @Post(':id/resume')
  @ApiOperation({ summary: 'Retoma uma campanha pausada' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha retomada com sucesso',
    schema: campaignSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao retomar campanha',
    schema: internalServerErrorSchema,
  })
  async resume(@Param('id') id: string) {
    return this.broadcastService.resumeCampaign(id);
  }

  /**
   * POST /broadcast/:id/requeue
   * Reenfileira destinatários pendentes de uma campanha
   */
  @Post(':id/requeue')
  @ApiOperation({ summary: 'Reenfileira destinatários pendentes de uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha reenfileirada com sucesso',
    schema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        status: { type: 'string', example: 'PROCESSING' },
        removedJobs: { type: 'number' },
        resetQueued: { type: 'number' },
        enqueued: { type: 'number' },
        batches: { type: 'number' },
        batchSize: { type: 'number' },
        delayBetweenBatches: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao reenfileirar campanha',
    schema: internalServerErrorSchema,
  })
  async requeue(@Param('id') id: string) {
    return this.broadcastService.requeueCampaign(id);
  }

  /**
   * POST /broadcast/:id/cancel
   * Cancela uma campanha
   */
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancela uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Campanha cancelada com sucesso',
    schema: campaignSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao cancelar campanha',
    schema: internalServerErrorSchema,
  })
  async cancel(@Param('id') id: string) {
    return this.broadcastService.cancelCampaign(id);
  }

  /**
   * GET /broadcast/:id/stats
   * Obtém estatísticas de uma campanha
   */
  @Get(':id/stats')
  @ApiOperation({ summary: 'Obtém estatísticas detalhadas de uma campanha' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Estatísticas retornadas com sucesso',
    schema: campaignStatsSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao obter estatísticas',
    schema: internalServerErrorSchema,
  })
  async getStats(@Param('id') id: string) {
    return this.broadcastService.getCampaignStats(id);
  }
}

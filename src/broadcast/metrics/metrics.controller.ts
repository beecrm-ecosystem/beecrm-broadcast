import { Controller, Get, Param, Query, Logger, BadRequestException } from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

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
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    error: { type: 'string' },
  },
};

const campaignMetricsRatesSchema = {
  type: 'object',
  properties: {
    success: { type: 'number', example: 95.5 },
    delivery: { type: 'number', example: 92.1 },
    read: { type: 'number', example: 83.7 },
    failure: { type: 'number', example: 4.5 },
    response: { type: 'number', example: 18.2 },
    optOut: { type: 'number', example: 1.3 },
  },
};

const campaignMetricsTimestampsSchema = {
  type: 'object',
  properties: {
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    lastResponseAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

const campaignMetricsResponseTimesSchema = {
  type: 'object',
  properties: {
    averageSeconds: { type: 'number', example: 123.45 },
    averageMinutes: { type: 'number', example: 2.06 },
    averageHumanized: { type: 'string', example: '2m 3s' },
  },
};

const campaignMetricsSchema = {
  type: 'object',
  properties: {
    campaignId: { type: 'string', example: 'cmp_123' },
    name: { type: 'string', example: 'Campanha Primavera' },
    status: { type: 'string', example: 'PROCESSING' },
    totalRecipients: { type: 'number', example: 5000 },
    sentCount: { type: 'number', example: 4800 },
    deliveredCount: { type: 'number', example: 4700 },
    readCount: { type: 'number', example: 3900 },
    failedCount: { type: 'number', example: 100 },
    responsesCount: { type: 'number', example: 850 },
    respondedCount: { type: 'number', example: 600 },
    optOutCount: { type: 'number', example: 65 },
    pendingCount: { type: 'number', example: 100 },
    progress: { type: 'number', example: 98.5 },
    rates: campaignMetricsRatesSchema,
    timestamps: campaignMetricsTimestampsSchema,
    responseTimes: campaignMetricsResponseTimesSchema,
  },
};

const campaignMetricsArraySchema = {
  type: 'array',
  items: campaignMetricsSchema,
};

const channelMetricsSchema = {
  type: 'object',
  properties: {
    channel: { type: 'string', example: 'whatsapp' },
    totalCampaigns: { type: 'number', example: 12 },
    activeCampaigns: { type: 'number', example: 4 },
    totalMessages: { type: 'number', example: 15000 },
    sentMessages: { type: 'number', example: 14000 },
    failedMessages: { type: 'number', example: 800 },
    responsesCount: { type: 'number', example: 2100 },
    respondedContacts: { type: 'number', example: 1800 },
    optOutCount: { type: 'number', example: 120 },
    successRate: { type: 'number', example: 93.33 },
    responseRate: { type: 'number', example: 12.0 },
    optOutRate: { type: 'number', example: 0.8 },
    averageResponseTimeSeconds: { type: 'number', example: 75.5 },
    averageResponseTimeHumanized: { type: 'string', example: '1m 15s' },
  },
};

const overallMetricsSchema = {
  type: 'object',
  properties: {
    total: { type: 'number', example: 42 },
    byStatus: {
      type: 'object',
      additionalProperties: { type: 'number' },
      example: { PROCESSING: 5, COMPLETED: 30, SCHEDULED: 7 },
    },
    totalMessages: { type: 'number', example: 52000 },
    sentMessages: { type: 'number', example: 50000 },
    failedMessages: { type: 'number', example: 1200 },
    deliveredMessages: { type: 'number', example: 49000 },
    readMessages: { type: 'number', example: 41000 },
    responsesCount: { type: 'number', example: 5600 },
    respondedContacts: { type: 'number', example: 4300 },
    optOutCount: { type: 'number', example: 350 },
    successRate: { type: 'number', example: 96.15 },
    deliveryRate: { type: 'number', example: 98.0 },
    readRate: { type: 'number', example: 83.67 },
    responseRate: { type: 'number', example: 8.27 },
    optOutRate: { type: 'number', example: 0.67 },
    averageResponseTimeSeconds: { type: 'number', example: 88.5 },
    averageResponseTimeHumanized: { type: 'string', example: '1m 28s' },
  },
};

@ApiTags('Metrics')
@Controller('api/metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * GET /api/metrics/campaign/:id
   * Obtém métricas de uma campanha específica
   */
  @Get('campaign/:id')
  @ApiOperation({ summary: 'Obtém métricas de uma campanha específica' })
  @ApiParam({ name: 'id', description: 'Identificador da campanha' })
  @ApiResponse({
    status: 200,
    description: 'Métricas da campanha retornadas com sucesso',
    schema: campaignMetricsSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Campanha não encontrada',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao buscar métricas da campanha',
    schema: internalServerErrorSchema,
  })
  async getCampaignMetrics(@Param('id') id: string) {
    this.logger.log(`Buscando métricas da campanha: ${id}`);
    return this.metricsService.getCampaignMetrics(id);
  }

  /**
   * GET /api/metrics/campaigns?ids=id1,id2,id3
   * Obtém métricas de múltiplas campanhas
   */
  @Get('campaigns')
  @ApiOperation({ summary: 'Obtém métricas de múltiplas campanhas' })
  @ApiQuery({
    name: 'ids',
    description: 'Lista de IDs de campanhas separados por vírgula',
    example: 'cmp_1,cmp_2,cmp_3',
  })
  @ApiResponse({
    status: 200,
    description: 'Métricas retornadas com sucesso',
    schema: campaignMetricsArraySchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Parâmetro ids ausente ou inválido',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao buscar métricas das campanhas',
    schema: internalServerErrorSchema,
  })
  async getBatchMetrics(@Query('ids') ids: string) {
    if (!ids) {
      throw new BadRequestException('Parâmetro ids é obrigatório');
    }

    const campaignIds = ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (campaignIds.length === 0) {
      throw new BadRequestException('Parâmetro ids deve conter pelo menos um identificador válido');
    }
    this.logger.log(`Buscando métricas de ${campaignIds.length} campanhas`);
    return this.metricsService.getBatchMetrics(campaignIds);
  }

  /**
   * GET /api/metrics/active
   * Obtém métricas de todas as campanhas ativas
   */
  @Get('active')
  @ApiOperation({ summary: 'Obtém métricas de todas as campanhas ativas' })
  @ApiResponse({
    status: 200,
    description: 'Métricas retornadas com sucesso',
    schema: campaignMetricsArraySchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao buscar métricas de campanhas ativas',
    schema: internalServerErrorSchema,
  })
  async getActiveCampaignsMetrics() {
    this.logger.log('Buscando métricas de campanhas ativas');
    return this.metricsService.getActiveCampaignsMetrics();
  }

  /**
   * GET /api/metrics/channel/:channel
   * Obtém métricas agregadas por canal
   */
  @Get('channel/:channel')
  @ApiOperation({ summary: 'Obtém métricas agregadas por canal' })
  @ApiParam({ name: 'channel', description: 'Nome do canal', example: 'whatsapp' })
  @ApiResponse({
    status: 200,
    description: 'Métricas do canal retornadas com sucesso',
    schema: channelMetricsSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao buscar métricas do canal',
    schema: internalServerErrorSchema,
  })
  async getMetricsByChannel(@Param('channel') channel: string) {
    this.logger.log(`Buscando métricas do canal: ${channel}`);
    return this.metricsService.getMetricsByChannel(channel);
  }

  /**
   * GET /api/metrics/overview
   * Obtém resumo geral de todas as campanhas
   */
  @Get('overview')
  @ApiOperation({ summary: 'Obtém resumo geral de todas as campanhas' })
  @ApiResponse({
    status: 200,
    description: 'Resumo geral retornado com sucesso',
    schema: overallMetricsSchema,
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao buscar métricas gerais',
    schema: internalServerErrorSchema,
  })
  async getOverallMetrics() {
    this.logger.log('Buscando métricas gerais');
    return this.metricsService.getOverallMetrics();
  }
}

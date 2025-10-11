import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';

@Controller('api/metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * GET /api/metrics/campaign/:id
   * Obtém métricas de uma campanha específica
   */
  @Get('campaign/:id')
  async getCampaignMetrics(@Param('id') id: string) {
    this.logger.log(`Buscando métricas da campanha: ${id}`);
    return this.metricsService.getCampaignMetrics(id);
  }

  /**
   * GET /api/metrics/campaigns?ids=id1,id2,id3
   * Obtém métricas de múltiplas campanhas
   */
  @Get('campaigns')
  async getBatchMetrics(@Query('ids') ids: string) {
    const campaignIds = ids.split(',').map((id) => id.trim());
    this.logger.log(`Buscando métricas de ${campaignIds.length} campanhas`);
    return this.metricsService.getBatchMetrics(campaignIds);
  }

  /**
   * GET /api/metrics/active
   * Obtém métricas de todas as campanhas ativas
   */
  @Get('active')
  async getActiveCampaignsMetrics() {
    this.logger.log('Buscando métricas de campanhas ativas');
    return this.metricsService.getActiveCampaignsMetrics();
  }

  /**
   * GET /api/metrics/channel/:channel
   * Obtém métricas agregadas por canal
   */
  @Get('channel/:channel')
  async getMetricsByChannel(@Param('channel') channel: string) {
    this.logger.log(`Buscando métricas do canal: ${channel}`);
    return this.metricsService.getMetricsByChannel(channel);
  }

  /**
   * GET /api/metrics/overview
   * Obtém resumo geral de todas as campanhas
   */
  @Get('overview')
  async getOverallMetrics() {
    this.logger.log('Buscando métricas gerais');
    return this.metricsService.getOverallMetrics();
  }
}

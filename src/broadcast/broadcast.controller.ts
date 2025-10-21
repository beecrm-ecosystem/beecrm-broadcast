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
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  AddRecipientsDto,
  CampaignFilterDto,
  AddContactsDto,
} from './schemas/broadcast.dto';

@Controller('broadcast')
export class BroadcastController {
  private readonly logger = new Logger(BroadcastController.name);

  constructor(
    private readonly broadcastService: BroadcastService,
    private readonly importService: ImportService,
  ) {}

  /**
   * POST /broadcast
   * Cria uma nova campanha
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
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
  async findAll(@Query() filters: CampaignFilterDto) {
    return this.broadcastService.findAll(filters);
  }

  /**
   * GET /broadcast/:id
   * Busca uma campanha específica
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.broadcastService.findOne(id);
  }

  /**
   * PUT /broadcast/:id
   * Atualiza uma campanha
   */
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateCampaignDto: UpdateCampaignDto) {
    return this.broadcastService.updateCampaign(id, updateCampaignDto);
  }

  /**
   * DELETE /broadcast/:id
   * Remove uma campanha (soft delete)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    return this.broadcastService.deleteCampaign(id);
  }

  /**
   * POST /broadcast/:id/recipients
   * Adiciona destinatários a uma campanha via JSON
   */
  @Post(':id/recipients')
  async addRecipients(@Param('id') id: string, @Body() addRecipientsDto: AddRecipientsDto) {
    return this.broadcastService.addRecipients(id, addRecipientsDto);
  }

  /**
   * POST /broadcast/:id/contacts
   * Alias legacy para adicionar destinatários usando o formato "contacts"
   */
  @Post(':id/contacts')
  async addContacts(@Param('id') id: string, @Body() addContactsDto: AddContactsDto) {
    return this.broadcastService.addContacts(id, addContactsDto);
  }

  /**
   * POST /broadcast/:id/recipients/upload
   * Adiciona destinatários via upload de arquivo CSV/XLSX
   */
  @Post(':id/recipients/upload')
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
  async start(@Param('id') id: string) {
    return this.broadcastService.startCampaign(id);
  }

  /**
   * POST /broadcast/:id/pause
   * Pausa uma campanha
   */
  @Post(':id/pause')
  async pause(@Param('id') id: string) {
    return this.broadcastService.pauseCampaign(id);
  }

  /**
   * POST /broadcast/:id/resume
   * Retoma uma campanha pausada
   */
  @Post(':id/resume')
  async resume(@Param('id') id: string) {
    return this.broadcastService.resumeCampaign(id);
  }

  /**
   * POST /broadcast/:id/cancel
   * Cancela uma campanha
   */
  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.broadcastService.cancelCampaign(id);
  }

  /**
   * GET /broadcast/:id/stats
   * Obtém estatísticas de uma campanha
   */
  @Get(':id/stats')
  async getStats(@Param('id') id: string) {
    return this.broadcastService.getCampaignStats(id);
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { ParsedContact } from '../services/file-parser.service';
import { CampaignWebhookService } from '../services/campaign-webhook.service';

export interface ImportContactsJob {
  campaignId: string;
  contacts: ParsedContact[];
  batchNumber: number;
  totalBatches: number;
}

@Processor('import-contacts-queue')
export class ImportContactsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportContactsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignWebhookService: CampaignWebhookService,
  ) {
    super();
  }

  async process(job: Job<ImportContactsJob>): Promise<any> {
    const { campaignId, contacts, batchNumber, totalBatches } = job.data;

    this.logger.log(
      `Importando lote ${batchNumber}/${totalBatches} com ${contacts.length} contatos - Campanha: ${campaignId}`,
    );

    try {
      // Insere contatos em lote
      const result = await this.prisma.campaignRecipient.createMany({
        data: contacts.map((contact) => ({
          campaignId,
          phoneNumber: contact.phone,
          name: contact.name,
          email: contact.email,
          variables: contact.variables,
          metadata: contact.metadata,
        })),
        skipDuplicates: true,
      });

      // Atualiza contador de destinatários da campanha
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          totalRecipients: { increment: result.count },
        },
      });

      this.logger.log(
        `✅ Lote ${batchNumber}/${totalBatches} importado: ${result.count} contatos adicionados`,
      );

      // Se for o último lote, envia webhook com o resumo
      if (batchNumber === totalBatches) {
        await this.sendImportCompletedWebhook(campaignId);
      }

      return {
        success: true,
        batchNumber,
        totalBatches,
        imported: result.count,
        skipped: contacts.length - result.count,
      };
    } catch (error) {
      this.logger.error(`Erro ao importar lote ${batchNumber}/${totalBatches}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envia webhook informando que a importação foi concluída
   */
  private async sendImportCompletedWebhook(campaignId: string): Promise<void> {
    try {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        this.logger.warn(`Campanha ${campaignId} não encontrada para envio de webhook`);
        return;
      }

      this.logger.log(
        `📤 Enviando webhook de importação concluída para campanha ${campaignId} (${campaign.totalRecipients} contatos)`,
      );

      await this.campaignWebhookService.sendBroadcastSummary(campaign, {
        status: campaign.status,
        totalContacts: campaign.totalRecipients,
      });
    } catch (error) {
      this.logger.error(`Erro ao enviar webhook de importação concluída: ${error.message}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ChannelDispatcher, DispatchResult } from '../channel-dispatcher.interface';
import { DiogenesService } from '../diogenes.service';
import { SendMessageJob } from '../../queues/broadcast.processor';

@Injectable()
export class WhatsAppDispatcher implements ChannelDispatcher {
  readonly channel = 'whatsapp';
  private readonly logger = new Logger(WhatsAppDispatcher.name);

  constructor(private readonly diogenesService: DiogenesService) {}

  async sendMessage(job: SendMessageJob): Promise<DispatchResult> {
    const {
      recipientPhone,
      recipientVariables,
      templateData,
      channel,
      templateName,
      templateLanguage,
    } = job;

    this.logger.log(`Enviando WhatsApp para ${recipientPhone} via Diogenes`);

    // Monta os componentes do template
    const components = this.buildComponents(templateData, recipientVariables);

    // Envia via Diogenes
    const response = await this.diogenesService.sendTemplate(channel, {
      number: recipientPhone,
      name: templateName,
      language: templateLanguage,
      components,
    });

    return {
      success: true,
      externalId: response.key.id,
      status: 'SENT',
      metadata: {
        remoteJid: response.key.remoteJid,
        messageType: response.messageType,
        messageTimestamp: response.messageTimestamp,
        instanceId: response.instanceId,
        diogenes_status: response.status,
      },
    };
  }

  buildComponents(templateData: any, variables: Record<string, string>): any {
    return this.diogenesService.buildTemplateComponents(templateData, variables);
  }
}

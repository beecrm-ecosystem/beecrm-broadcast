import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ChannelDispatcher, DispatchResult } from '../channel-dispatcher.interface';
import { SendMessageJob } from '../../queues/broadcast.processor';

@Injectable()
export class RcsDispatcher implements ChannelDispatcher {
  readonly channel = 'rcs';
  private readonly logger = new Logger(RcsDispatcher.name);

  private readonly apiUrl = process.env.RCS_API_URL || 'https://rcs.pontaltech.com.br/api';
  private readonly apiToken = process.env.RCS_API_TOKEN || '';

  constructor(private readonly httpService: HttpService) {}

  async sendMessage(job: SendMessageJob): Promise<DispatchResult> {
    const { recipientPhone, templateData, recipientVariables } = job;

    this.logger.log(`Enviando RCS para ${recipientPhone} via Pontaltech`);

    const content = this.buildRcsPayload(templateData, recipientVariables);

    const requestBody: Record<string, any> = {
      clientId: templateData.metadata?.ms_client_id,
      channelId: templateData.metadata?.channel_id,
      agentType: templateData.metadata?.agent_type,
      messages: [{ phone: recipientPhone, vars: recipientVariables }],
      content,
    };

    // Suporte a fallback SMS
    if (templateData.fallback_enabled && templateData.fallback_text) {
      requestBody.fallback = {
        type: 'sms',
        text: this.substituteVars(templateData.fallback_text, recipientVariables),
      };
    }

    try {
      const response = await this.httpService.axiosRef.post(
        `${this.apiUrl}/messages`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const messageId = response.data?.messageId || response.data?.id;

      this.logger.log(`RCS enviado com sucesso para ${recipientPhone}. ID: ${messageId}`);

      return {
        success: true,
        externalId: messageId,
        status: 'SENT',
        metadata: {
          provider: 'pontaltech',
          rcsMessageType: templateData.rcs_message_type,
          responseData: response.data,
        },
      };
    } catch (error) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message;

      this.logger.error(`Erro ao enviar RCS para ${recipientPhone}: ${errorMessage}`);

      if (error.response?.data) {
        this.logger.error(`Response body: ${JSON.stringify(error.response.data)}`);
      }

      // Propaga o erro com informacoes adicionais para o processor classificar
      throw error;
    }
  }

  buildComponents(templateData: any, variables: Record<string, string>): any {
    return this.buildRcsPayload(templateData, variables);
  }

  private buildRcsPayload(
    templateData: any,
    variables: Record<string, string>,
  ): Record<string, any> {
    const messageType = templateData.rcs_message_type;
    const payload = templateData.rcs_content?.payload;

    switch (messageType) {
      case 'text':
        return {
          text: {
            message: this.substituteVars(payload?.text?.message || '', variables),
          },
        };

      case 'template':
        return {
          templateId: payload?.templateId,
        };

      case 'rich_card':
        return this.processRichCardPayload(payload, variables);

      case 'carousel':
        return this.processCarouselPayload(payload, variables);

      default:
        this.logger.warn(`Tipo de mensagem RCS desconhecido: ${messageType}, usando payload direto`);
        return payload || {};
    }
  }

  private processRichCardPayload(
    payload: any,
    variables: Record<string, string>,
  ): Record<string, any> {
    if (!payload) {
      return {};
    }

    // Deep-clone para nao alterar o original
    const result = JSON.parse(JSON.stringify(payload));

    // Substitui variaveis em campos de texto do rich card
    if (result.title) {
      result.title = this.substituteVars(result.title, variables);
    }
    if (result.description) {
      result.description = this.substituteVars(result.description, variables);
    }

    return result;
  }

  private processCarouselPayload(
    payload: any,
    variables: Record<string, string>,
  ): Record<string, any> {
    if (!payload) {
      return {};
    }

    // Deep-clone para nao alterar o original
    const result = JSON.parse(JSON.stringify(payload));

    // Substitui variaveis nos cards do carousel
    if (Array.isArray(result.cards)) {
      result.cards = result.cards.map((card: any) => {
        if (card.title) {
          card.title = this.substituteVars(card.title, variables);
        }
        if (card.description) {
          card.description = this.substituteVars(card.description, variables);
        }
        return card;
      });
    }

    return result;
  }

  private substituteVars(text: string, variables: Record<string, string>): string {
    if (typeof text !== 'string') {
      return '';
    }

    return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (variables && Object.prototype.hasOwnProperty.call(variables, key)) {
        return String(variables[key] ?? '');
      }
      return '';
    });
  }
}

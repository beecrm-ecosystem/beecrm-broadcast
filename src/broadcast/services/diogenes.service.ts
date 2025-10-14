import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SendTemplateDto {
  number: string;
  name: string;
  language: string;
  components: TemplateComponent[];
}

export interface TemplateComponent {
  type: string;
  sub_type?: string;
  index?: string;
  parameters?: TemplateParameter[];
}

export interface TemplateParameter {
  type: string;
  text: string;
}

export interface DiogenesResponse {
  key: {
    fromMe: boolean;
    id: string;
    remoteJid: string;
  };
  message: {
    conversation: string;
  };
  messageType: string;
  messageTimestamp: number;
  instanceId: string;
  status: string;
  source: string;
}

@Injectable()
export class DiogenesService {
  private readonly logger = new Logger(DiogenesService.name);
  private readonly baseUrl = process.env.DIOGENES_URL || 'https://diogenes.beecrm.io';
  private readonly apiKey = process.env.HERMES_API_KEY;
  private readonly isTestMode = process.env.DIOGENES_TEST_MODE === 'true';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Envia um template via Diogenes
   */
  async sendTemplate(channel: string, data: SendTemplateDto): Promise<DiogenesResponse> {
    const url = `${this.baseUrl}/message/sendTemplate/${channel}`;

    try {
      this.logger.log(`Enviando mensagem para ${data.number} via ${channel}`);
      this.logger.debug(`URL: ${url}`);
      this.logger.debug(`Payload: ${JSON.stringify(data, null, 2)}`);

      // Modo de teste: simula envio sem chamar API real
      if (this.isTestMode) {
        this.logger.warn('MODO TESTE ATIVADO - Simulando envio sem chamar Diogenes');
        return this.simulateResponse(data.number);
      }

      const response = await firstValueFrom(
        this.httpService.post<DiogenesResponse>(url, data, {
          headers: {
            apikey: this.apiKey,
          },
        }),
      );

      this.logger.log(`Mensagem enviada com sucesso. ID: ${response.data.key.id}`);

      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem para ${data.number}: ${error.message}`);

      // Log detalhado do erro
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error(`URL chamada: ${url}`);
        this.logger.error(`Response: ${JSON.stringify(error.response.data)}`);
      }

      throw error;
    }
  }

  /**
   * Simula resposta do Diogenes para testes
   */
  private simulateResponse(number: string): DiogenesResponse {
    const mockId = `wamid.mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return {
      key: {
        fromMe: true,
        id: mockId,
        remoteJid: `${number.replace('+', '')}@s.whatsapp.net`,
      },
      message: {
        conversation: '▶template_test◀',
      },
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      instanceId: 'test-instance-id',
      status: 'PENDING',
      source: 'test',
    };
  }

  /**
   * Monta os componentes do template baseado no templateData e variáveis do destinatário
   */
  buildTemplateComponents(
    templateData: any,
    recipientVariables: Record<string, any>,
  ): TemplateComponent[] {
    const components: TemplateComponent[] = [];

    if (!templateData.components) {
      return components;
    }

    for (const component of templateData.components) {
      if (component.type === 'HEADER' && component.format === 'TEXT') {
        // Header com texto
        const headerParams = this.extractVariables(component.text, recipientVariables);
        if (headerParams.length > 0) {
          components.push({
            type: 'header',
            parameters: headerParams.map((text) => ({ type: 'text', text })),
          });
        }
      }

      if (component.type === 'BODY') {
        // Body com variáveis
        const bodyParams = this.extractVariables(component.text, recipientVariables);
        if (bodyParams.length > 0) {
          components.push({
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text })),
          });
        }
      }

      if (component.type === 'BUTTONS' && component.buttons) {
        // Buttons com URLs dinâmicas
        component.buttons.forEach((button: any, index: number) => {
          if (button.type === 'URL' && button.url.includes('{{')) {
            const urlParams = this.extractVariables(button.url, recipientVariables);
            if (urlParams.length > 0) {
              components.push({
                type: 'button',
                sub_type: 'URL',
                index: String(index),
                parameters: urlParams.map((text) => ({ type: 'text', text })),
              });
            }
          }
        });
      }
    }

    return components;
  }

  /**
   * Extrai e substitui variáveis do template
   * Suporta: {{1}}, {{2}}, {{nome}}, etc
   */
  private extractVariables(text: string, variables: Record<string, any>): string[] {
    const matches = text.match(/\{\{(\d+|[a-zA-Z_]+)\}\}/g);
    if (!matches) {
      return [];
    }

    return matches.map((match) => {
      const key = match.replace(/\{\{|\}\}/g, '');

      // Se for número ({{1}}, {{2}}), usa o índice das variáveis
      if (/^\d+$/.test(key)) {
        const index = parseInt(key) - 1;
        const variableKeys = Object.keys(variables);
        return variables[variableKeys[index]] || '';
      }

      // Se for nome de variável ({{nome}}, {{email}})
      return variables[key] || '';
    });
  }
}

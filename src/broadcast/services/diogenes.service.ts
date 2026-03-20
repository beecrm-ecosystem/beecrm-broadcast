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
  text?: string;
  [key: string]: any;
}
export interface TemplateComponentDefinition {
  type: string;
  parameters?: Array<{ type: string; text?: string; [key: string]: any }>;
  text?: string;
  format?: string;
  buttons?: Array<{ type: string; url?: string }>;
  sub_type?: string;
  subType?: string;
  index?: number | string;
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
  private readonly breaker = {
    state: 'CLOSED' as 'CLOSED' | 'OPEN' | 'HALF_OPEN',
    failures: 0,
    nextRetryAt: 0,
  };
  private readonly MAX_FAILURES_BEFORE_OPEN = 3;

  constructor(private readonly httpService: HttpService) {}

  /**
   * Envia um template via Diogenes
   */
  async sendTemplate(channel: string, data: SendTemplateDto): Promise<DiogenesResponse> {
    const url = `${this.baseUrl}/message/sendTemplate/${channel}`;

    // Circuit breaker: bloqueia chamadas durante cooldown
    if (this.isCircuitOpen()) {
      const waitMs = Math.max(0, this.breaker.nextRetryAt - Date.now());
      throw new Error(`Circuit breaker aberto para Diogenes. Aguarde ${waitMs}ms`);
    }

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
        this.httpService.post<DiogenesResponse>(
          url,
          { ...data, broadcast: true },
          {
            headers: {
              apikey: this.apiKey,
            },
          },
        ),
      );

      const payload = response?.data;

      if (!payload) {
        throw new Error('Resposta vazia do Diogenes');
      }

      if (!payload.key || !payload.key.id) {
        this.logger.error(`Resposta inválida do Diogenes: ${JSON.stringify(payload, null, 2)}`);
        throw new Error('Resposta do Diogenes sem identificador da mensagem');
      }

      this.logger.log(`Mensagem enviada com sucesso. ID: ${payload.key.id}`);

      // Sucesso fecha o circuito
      this.resetBreaker();

      return payload;
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem para ${data.number}: ${error.message}`);

      // Log detalhado do erro
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error(`URL chamada: ${url}`);
        this.logger.error(`Response: ${JSON.stringify(error.response.data)}`);
      }

      const status = error.response?.status as number | undefined;
      const backoffMs = this.recordBreakerFailure(status, error.response?.headers);
      if (backoffMs > 0) {
        this.logger.warn(`Backoff adaptativo de ${backoffMs}ms após status ${status ?? 'N/A'}`);
        await this.delay(backoffMs);
      }

      // Backpressure: sinaliza pausa do enfileiramento em caso de 429/5xx
      if (status === 429 || (status !== undefined && status >= 500)) {
        this.logger.warn('Sugerindo pausa do enfileiramento devido a erros 429/5xx.');
        throw new Error('BACKPRESSURE: pause enqueue');
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

    if (!templateData || !Array.isArray(templateData.components)) {
      return components;
    }

    const componentDefinitions: TemplateComponentDefinition[] = templateData.components;

    for (const rawComponent of componentDefinitions) {
      if (!rawComponent) {
        continue;
      }

      const normalizedType = this.normalizeComponentType(rawComponent.type);

      if (Array.isArray(rawComponent.parameters)) {
        const resolvedParameters = this.resolveComponentParameters(rawComponent.parameters);
        const normalizedParameters = this.applyTemplateVariables(
          resolvedParameters,
          recipientVariables,
        );

        components.push(
          this.decorateComponent(
            normalizedType,
            normalizedParameters,
            rawComponent.sub_type ?? rawComponent.subType,
            rawComponent.index,
          ),
        );
        continue;
      }

      if (normalizedType === 'header' && rawComponent.format?.toUpperCase() === 'TEXT') {
        const headerParams = this.extractVariables(rawComponent.text ?? '', recipientVariables);
        if (headerParams.length > 0) {
          components.push({
            type: 'header',
            parameters: headerParams.map((text) => ({ type: 'text', text })),
          });
        }
        continue;
      }

      if (normalizedType === 'body') {
        const bodyParams = this.extractVariables(rawComponent.text ?? '', recipientVariables);
        if (bodyParams.length > 0) {
          components.push({
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text })),
          });
        } else if (rawComponent.text) {
          components.push(
            this.decorateComponent('body', [
              {
                type: 'text',
                text: this.resolveTemplateText(rawComponent.text, recipientVariables),
              },
            ]),
          );
        }
        continue;
      }

      if (normalizedType === 'buttons' && Array.isArray(rawComponent.buttons)) {
        rawComponent.buttons.forEach((button: any, index: number) => {
          if (button.type === 'URL' && typeof button.url === 'string') {
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
    if (typeof text !== 'string') {
      return [];
    }

    const matches = text.match(/\{\{(\d+|[a-zA-Z_][\w-]*)\}\}/g);
    if (!matches) {
      return [];
    }

    return matches.map((match) => {
      const key = match.replace(/\{\{|\}\}/g, '');
      return this.getVariableValue(key, variables);
    });
  }

  private normalizeComponentType(type: any): string {
    if (typeof type === 'string') {
      return type.toLowerCase();
    }
    return 'body';
  }

  private normalizeParameterType(type: any): string {
    if (typeof type === 'string') {
      return type.toLowerCase();
    }
    return 'text';
  }

  private resolveComponentParameters(parameters: any[]): TemplateParameter[] {
    if (!Array.isArray(parameters)) {
      return [];
    }

    return parameters.map((param) => {
      const normalizedType = this.normalizeParameterType(param?.type);

      const sanitizedParam: TemplateParameter = { type: normalizedType };

      if (param && typeof param === 'object') {
        for (const [key, value] of Object.entries(param)) {
          if (key === 'type') {
            continue;
          }
          sanitizedParam[key] = value;
        }
      }

      return sanitizedParam;
    });
  }

  private applyTemplateVariables(
    parameters: TemplateParameter[],
    recipientVariables: Record<string, any>,
  ): TemplateParameter[] {
    return parameters.map((param) => {
      if (param.type !== 'text') {
        return param;
      }

      return {
        ...param,
        text: this.resolveTemplateText(param.text ?? '', recipientVariables),
      };
    });
  }

  private decorateComponent(
    type: string,
    parameters: TemplateParameter[],
    subType?: string,
    index?: string | number,
  ): TemplateComponent {
    return {
      type,
      sub_type: subType,
      index: index !== undefined && index !== null ? String(index) : undefined,
      parameters,
    };
  }

  private resolveTemplateText(text: string, variables: Record<string, any>): string {
    if (typeof text !== 'string') {
      return '';
    }

    const placeholderRegex = /\{\{(\d+|[a-zA-Z_][\w-]*)\}\}/g;

    return text.replace(placeholderRegex, (_, key: string) =>
      this.getVariableValue(key, variables),
    );
  }

  private getVariableValue(key: string, variables: Record<string, any>): string {
    if (!variables || typeof variables !== 'object') {
      return '-';
    }

    const normalizedKey = key.toString();

    if (Object.prototype.hasOwnProperty.call(variables, normalizedKey)) {
      return this.normalizeVariableValue(variables[normalizedKey]);
    }

    const lowerKey = normalizedKey.toLowerCase();
    for (const [varKey, value] of Object.entries(variables)) {
      if (varKey.toLowerCase() === lowerKey) {
        return this.normalizeVariableValue(value);
      }
    }

    if (/^\d+$/.test(normalizedKey)) {
      const numericIndex = parseInt(normalizedKey, 10) - 1;
      const variableValues = Object.values(variables);
      if (numericIndex >= 0 && numericIndex < variableValues.length) {
        return this.normalizeVariableValue(variableValues[numericIndex]);
      }
    }

    return '-';
  }

  private normalizeVariableValue(value: any): string {
    if (value === null || value === undefined) {
      return '-';
    }

    const str = String(value).trim();
    return str || '-';
  }

  private isCircuitOpen(): boolean {
    if (this.breaker.state === 'OPEN') {
      const now = Date.now();
      if (now >= this.breaker.nextRetryAt) {
        this.breaker.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  private resetBreaker() {
    this.breaker.state = 'CLOSED';
    this.breaker.failures = 0;
    this.breaker.nextRetryAt = 0;
  }

  private recordBreakerFailure(status?: number, headers?: Record<string, any>): number {
    const shouldTrip = status === 429 || (status !== undefined && status >= 500);
    if (!shouldTrip) {
      return 0;
    }

    this.breaker.failures += 1;

    const backoffMs = this.computeBackoffMs(status, headers, this.breaker.failures);

    if (this.breaker.failures >= this.MAX_FAILURES_BEFORE_OPEN) {
      const cooldown = Math.min(60000, backoffMs * 2 || 5000);
      this.breaker.state = 'OPEN';
      this.breaker.nextRetryAt = Date.now() + cooldown;
      this.logger.warn(`Circuit breaker aberto por ${cooldown}ms após status ${status}`);
    }

    return backoffMs;
  }

  private computeBackoffMs(
    status: number | undefined,
    headers: Record<string, any> | undefined,
    failures: number,
  ): number {
    const retryAfterHeader = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (retryAfterHeader) {
      const retrySeconds = Number(retryAfterHeader);
      if (!Number.isNaN(retrySeconds) && retrySeconds > 0) {
        return retrySeconds * 1000;
      }
    }

    const base = status === 429 ? 2000 : 500;
    const exp = Math.min(failures - 1, 4); // cap no expoente
    return Math.min(15000, base * Math.pow(2, exp));
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

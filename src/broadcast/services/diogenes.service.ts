import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isMetaApiError, tryParseMetaError } from './meta-error';

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

interface BreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  nextRetryAt: number;
}

@Injectable()
export class DiogenesService {
  private readonly logger = new Logger(DiogenesService.name);
  private readonly baseUrl = process.env.DIOGENES_URL || 'https://diogenes.beecrm.io';
  private readonly apiKey = process.env.HERMES_API_KEY;
  private readonly isTestMode = process.env.DIOGENES_TEST_MODE === 'true';
  // Um breaker por canal (BC-04): rate limit da Meta e por numero emissor, e
  // um breaker unico por processo fazia o 130429 de um tenant bloquear o envio
  // de todos os outros canais naquele processo.
  private readonly breakers = new Map<string, BreakerState>();
  private readonly MAX_FAILURES_BEFORE_OPEN = 3;

  constructor(private readonly httpService: HttpService) {}

  /**
   * Envia um template via Diogenes
   */
  async sendTemplate(channel: string, data: SendTemplateDto): Promise<DiogenesResponse> {
    const url = `${this.baseUrl}/message/sendTemplate/${channel}`;

    // Circuit breaker do canal: bloqueia chamadas durante cooldown
    const breaker = this.breakerFor(channel);
    if (this.isCircuitOpen(breaker)) {
      const waitMs = Math.max(0, breaker.nextRetryAt - Date.now());
      throw new Error(`Circuit breaker aberto para Diogenes (${channel}). Aguarde ${waitMs}ms`);
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
      const httpStatusCode = response?.status;

      if (!payload) {
        throw new Error('Resposta vazia do Diogenes');
      }

      if (!payload.key || !payload.key.id) {
        this.logger.error(`Resposta inválida do Diogenes: ${JSON.stringify(payload, null, 2)}`);
        const metaError = tryParseMetaError(payload, httpStatusCode);
        if (metaError) {
          throw metaError;
        }
        throw new Error('Resposta do Diogenes sem identificador da mensagem');
      }

      this.logger.log(`Mensagem enviada com sucesso. ID: ${payload.key.id}`);

      // Sucesso fecha o circuito do canal
      this.breakers.delete(channel);

      // Anexa o HTTP status code ao payload para rastreamento
      (payload as any).httpStatusCode = httpStatusCode;

      return payload;
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem para ${data.number}: ${error.message}`);

      // Erro tipado da Meta (HTTP 200 com payload de erro). Decide
      // backpressure pelo `policy` em vez do status HTTP.
      if (isMetaApiError(error)) {
        if (error.policy === 'rate_limit') {
          this.tripBreakerForRateLimit(breaker, error.metaCode);
          this.logger.warn(
            `Rate limit Meta #${error.metaCode}: pausando enfileiramento (fbtrace_id=${error.fbtraceId ?? 'n/a'})`,
          );
          throw new Error(
            `BACKPRESSURE: pause enqueue (meta=${error.metaCode}; ${error.metaMessage})`,
          );
        }
        throw error;
      }

      // Log detalhado do erro
      if (error.response) {
        this.logger.error(`Status: ${error.response.status}`);
        this.logger.error(`URL chamada: ${url}`);
        this.logger.error(`Response: ${JSON.stringify(error.response.data)}`);
      }

      const status = error.response?.status as number | undefined;
      const backoffMs = this.recordBreakerFailure(breaker, status, error.response?.headers);
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
        }
        // Se não há variáveis ({{1}}, {{2}}, etc.), não envia componente body —
        // o Meta rejeita com erro 132000 se enviar parâmetros para template sem variáveis.
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

  private breakerFor(channel: string): BreakerState {
    let breaker = this.breakers.get(channel);
    if (!breaker) {
      breaker = { state: 'CLOSED', failures: 0, nextRetryAt: 0 };
      this.breakers.set(channel, breaker);
    }
    return breaker;
  }

  private isCircuitOpen(breaker: BreakerState): boolean {
    if (breaker.state === 'OPEN') {
      const now = Date.now();
      if (now >= breaker.nextRetryAt) {
        breaker.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Abre o circuit breaker imediatamente quando a Meta sinaliza rate
   * limit (130429 etc). O cooldown cresce a cada disparo consecutivo
   * para dar tempo do throughput voltar ao normal: 60s, 120s, 300s.
   */
  private tripBreakerForRateLimit(breaker: BreakerState, metaCode: number) {
    breaker.failures += 1;
    const ladder = [60_000, 120_000, 300_000];
    const cooldown = ladder[Math.min(breaker.failures - 1, ladder.length - 1)];
    breaker.state = 'OPEN';
    breaker.nextRetryAt = Date.now() + cooldown;
    this.logger.warn(
      `Circuit breaker aberto por ${cooldown}ms após Meta #${metaCode} (failures=${breaker.failures})`,
    );
  }

  private recordBreakerFailure(
    breaker: BreakerState,
    status?: number,
    headers?: Record<string, any>,
  ): number {
    const shouldTrip = status === 429 || (status !== undefined && status >= 500);
    if (!shouldTrip) {
      return 0;
    }

    breaker.failures += 1;

    const backoffMs = this.computeBackoffMs(status, headers, breaker.failures);

    if (breaker.failures >= this.MAX_FAILURES_BEFORE_OPEN) {
      const cooldown = Math.min(60000, backoffMs * 2 || 5000);
      breaker.state = 'OPEN';
      breaker.nextRetryAt = Date.now() + cooldown;
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

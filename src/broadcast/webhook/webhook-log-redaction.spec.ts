/* eslint-disable @typescript-eslint/require-await -- mock da fila devolve promessas sem await */
/**
 * O token de webhook de provedor (segmento de URL ou header X-Webhook-Token) e o Bearer da API
 * nao podem aparecer no log: LoggerMiddleware (fora de producao loga URL e todos os headers; em
 * producao loga URL de 4xx) e AllExceptionsFilter (loga URL e params em todo ambiente, e devolvia
 * o path na resposta). Caminho HTTP real, com o logger capturado.
 */
import { INestApplication, Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import * as request from 'supertest';
import { ApiTokenGuard } from '../auth/api-token.guard';
import { AllExceptionsFilter } from '../filters/http-exception.filter';
import { LoggerMiddleware } from '../middlewares/logger.middleware';
import { WebhookQueueService } from '../services/webhook-queue.service';
import { PROVIDER_WEBHOOK_PATH, providerWebhookBodyParser } from './provider-webhook-body';
import { REDACTED, redactHeaders, redactParams, redactWebhookUrl } from './webhook-log-redaction';
import { WebhookController } from './webhook.controller';

const TOKEN = 'token-secreto-de-teste-0123456789';
const WRONG_TOKEN = 'token-antigo-rotacionado-9876543210';
const API_TOKEN = 'bearer-secreto-de-teste';

const queue = {
  addMetaWebhook: jest.fn(async () => 'job'),
  addMetaMessage: jest.fn(async () => 'job'),
  addDiogenesWebhook: jest.fn(async () => 'job'),
  addRcsWebhook: jest.fn(async () => 'job'),
  getQueueStats: jest.fn(async () => ({})),
};

@Module({
  controllers: [WebhookController],
  providers: [
    { provide: WebhookQueueService, useValue: queue },
    { provide: APP_GUARD, useClass: ApiTokenGuard },
  ],
})
class TestWebhookModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [TestWebhookModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(PROVIDER_WEBHOOK_PATH, providerWebhookBodyParser());
  app.use(json());
  await app.init();
  return app;
}

describe('redacao do token de webhook nos logs', () => {
  const savedEnv = { ...process.env };
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
    }
    process.env.PROVIDER_WEBHOOK_TOKEN = TOKEN;
    process.env.BROADCAST_SERVICE_TOKEN = API_TOKEN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  const payload = { messageId: 'rcs-1', status: 'DELIVERED' };

  it.each(['development', 'production'])(
    'no token value reaches the log (%s): URL, header, params and error path',
    async (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      const app = await bootApp();

      try {
        const server = app.getHttpServer();
        await request(server).post(`/api/webhook/rcs/${TOKEN}`).send(payload).expect(201);
        await request(server)
          .post('/api/webhook/rcs')
          .set('X-Webhook-Token', TOKEN)
          .send(payload)
          .expect(201);
        const refused = await request(server)
          .post(`/api/webhook/rcs/${WRONG_TOKEN}?x=1`)
          .send(payload)
          .expect(401);
        await request(server)
          .get('/api/webhook/queue/stats')
          .set('Authorization', `Bearer ${API_TOKEN}`)
          .expect(200);

        const all = logged.join('\n');
        expect(all).not.toContain(TOKEN);
        expect(all).not.toContain(WRONG_TOKEN);
        expect(all).not.toContain(API_TOKEN);
        expect(JSON.stringify(refused.body)).not.toContain(WRONG_TOKEN);

        // Controle positivo: o log das rotas aconteceu, com o marcador no lugar do segredo.
        expect(all).toContain(`/api/webhook/rcs/${REDACTED}`);
      } finally {
        await app.close();
      }
    },
  );

  it('redaction helpers keep everything but the secret', () => {
    expect(redactWebhookUrl(`/api/webhook/campaign-status/${TOKEN}?a=1`)).toBe(
      `/api/webhook/campaign-status/${REDACTED}?a=1`,
    );
    expect(redactWebhookUrl('/api/webhook/queue/stats')).toBe('/api/webhook/queue/stats');
    expect(redactWebhookUrl('/api/webhook/campaign-status')).toBe('/api/webhook/campaign-status');
    expect(
      redactHeaders({ 'x-webhook-token': TOKEN, Authorization: 'Bearer x', 'content-type': 'a' }),
    ).toEqual({ 'x-webhook-token': REDACTED, Authorization: REDACTED, 'content-type': 'a' });
    expect(redactParams({ token: TOKEN, id: '1' })).toEqual({ token: REDACTED, id: '1' });
    expect(redactParams({ path: ['webhook', 'rcs', TOKEN] })).toEqual({
      path: ['webhook', 'rcs', REDACTED],
    });
    expect(redactParams({ path: ['broadcast', 'abc'] })).toEqual({ path: ['broadcast', 'abc'] });
  });
});

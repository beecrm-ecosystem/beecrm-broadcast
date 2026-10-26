/* eslint-disable @typescript-eslint/require-await -- mocks do Prisma/fila devolvem promessas sem await */
/**
 * SEC-04 / BC-06 (auditoria de campanhas de 26/10/2026) — autenticidade dos webhooks de provedor,
 * pelo caminho HTTP real (Nest + Express + guards globais), com a fila mockada.
 *
 * Cada recusa tem o controle positivo ao lado: o mesmo pedido com token/assinatura valido passa
 * e chega na fila.
 */
import { INestApplication, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { json } from 'express';
import * as request from 'supertest';
import { ApiTokenGuard } from '../auth/api-token.guard';
import { WebhookQueueService } from '../services/webhook-queue.service';
import { PROVIDER_WEBHOOK_PATH, providerWebhookBodyParser } from './provider-webhook-body';
import { WebhookController } from './webhook.controller';

const TOKEN = 'token-de-teste-provedor';
const META_SECRET = 'app-secret-de-teste';
const API_TOKEN = 'token-de-teste-api';

const ENV_KEYS = ['PROVIDER_WEBHOOK_TOKEN', 'META_APP_SECRET', 'BROADCAST_SERVICE_TOKEN'] as const;

const metaPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '551100000000', phone_number_id: 'pn-1' },
            statuses: [
              {
                id: 'wamid.1',
                status: 'failed',
                timestamp: '1900000000',
                recipient_id: '5511999990001',
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('WebhookController — autenticidade dos webhooks de provedor', () => {
  let app: INestApplication;
  let queue: Record<string, jest.Mock>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    Logger.overrideLogger(false);

    queue = {
      addMetaWebhook: jest.fn(async () => 'job-meta'),
      addMetaMessage: jest.fn(async () => 'job-msg'),
      addDiogenesWebhook: jest.fn(async () => 'job-diogenes'),
      addRcsWebhook: jest.fn(async () => 'job-rcs'),
      getQueueStats: jest.fn(async () => ({ waiting: 0 })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: WebhookQueueService, useValue: queue },
        { provide: APP_GUARD, useClass: ApiTokenGuard },
      ],
    }).compile();

    // Mesma montagem do main.ts: parser com corpo cru nas rotas de webhook, antes do geral.
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    app.setGlobalPrefix('api');
    app.use(PROVIDER_WEBHOOK_PATH, providerWebhookBodyParser());
    app.use(json({ limit: '25mb' }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    Object.values(queue).forEach((fn) => fn.mockClear());
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  const http = () => request(app.getHttpServer());

  describe('token compartilhado (PROVIDER_WEBHOOK_TOKEN)', () => {
    beforeEach(() => {
      process.env.PROVIDER_WEBHOOK_TOKEN = TOKEN;
    });

    it.each(['campaign-status', 'diogenes', 'rcs'])(
      '%s without token -> 401, nothing queued',
      async (route) => {
        await http().post(`/api/webhook/${route}`).send(metaPayload).expect(401);

        expect(queue.addMetaWebhook).not.toHaveBeenCalled();
        expect(queue.addDiogenesWebhook).not.toHaveBeenCalled();
        expect(queue.addRcsWebhook).not.toHaveBeenCalled();
      },
    );

    it('wrong token in header or URL -> 401', async () => {
      await http()
        .post('/api/webhook/campaign-status')
        .set('X-Webhook-Token', 'errado')
        .send(metaPayload)
        .expect(401);
      await http().post('/api/webhook/campaign-status/errado').send(metaPayload).expect(401);

      expect(queue.addMetaWebhook).not.toHaveBeenCalled();
    });

    it('positive control: token in header is accepted and the status is queued', async () => {
      await http()
        .post('/api/webhook/campaign-status')
        .set('X-Webhook-Token', TOKEN)
        .send(metaPayload)
        .expect(201);

      expect(queue.addMetaWebhook).toHaveBeenCalledTimes(1);
    });

    it('positive control: token as last URL segment is accepted (diogenes and rcs too)', async () => {
      await http().post(`/api/webhook/campaign-status/${TOKEN}`).send(metaPayload).expect(201);
      await http()
        .post(`/api/webhook/diogenes/${TOKEN}`)
        .send({
          event: 'messages.update',
          instance: 'i',
          data: { key: { remoteJid: 'r', fromMe: true, id: 'x' } },
        })
        .expect(201);
      await http()
        .post(`/api/webhook/rcs/${TOKEN}`)
        .send({ messageId: 'rcs-1', status: 'DELIVERED' })
        .expect(201);

      expect(queue.addMetaWebhook).toHaveBeenCalledTimes(1);
      expect(queue.addDiogenesWebhook).toHaveBeenCalledTimes(1);
      expect(queue.addRcsWebhook).toHaveBeenCalledTimes(1);
    });
  });

  describe('assinatura da Meta (META_APP_SECRET) no campaign-status', () => {
    // Corpo com escape de unicode: re-serializar o JSON parseado NAO reproduz estes bytes.
    const rawBody = JSON.stringify(metaPayload).replace(
      'whatsapp_business_account',
      'whatsapp\\u005fbusiness_account',
    );
    const sign = (body: string, secret = META_SECRET) =>
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    beforeEach(() => {
      process.env.META_APP_SECRET = META_SECRET;
    });

    it('positive control: valid X-Hub-Signature-256 over the raw body is accepted', async () => {
      await http()
        .post('/api/webhook/campaign-status')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(rawBody))
        .send(rawBody)
        .expect(201);

      expect(queue.addMetaWebhook).toHaveBeenCalledTimes(1);
    });

    it('missing, wrong-secret or tampered-body signature -> 401', async () => {
      const tampered = rawBody.replace('"failed"', '"read"');

      await http()
        .post('/api/webhook/campaign-status')
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(401);
      await http()
        .post('/api/webhook/campaign-status')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(rawBody, 'outro-secret'))
        .send(rawBody)
        .expect(401);
      await http()
        .post('/api/webhook/campaign-status')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(rawBody))
        .send(tampered)
        .expect(401);

      expect(queue.addMetaWebhook).not.toHaveBeenCalled();
    });

    it('with both envs, the shared token also opens campaign-status', async () => {
      process.env.PROVIDER_WEBHOOK_TOKEN = TOKEN;

      await http()
        .post('/api/webhook/campaign-status')
        .set('X-Webhook-Token', TOKEN)
        .send(metaPayload)
        .expect(201);
    });

    it.each(['diogenes', 'rcs'])(
      'a valid Meta signature does not open %s (only campaign-status accepts it)',
      async (route) => {
        process.env.PROVIDER_WEBHOOK_TOKEN = TOKEN;

        await http()
          .post(`/api/webhook/${route}`)
          .set('Content-Type', 'application/json')
          .set('X-Hub-Signature-256', sign(rawBody))
          .send(rawBody)
          .expect(401);

        expect(queue.addDiogenesWebhook).not.toHaveBeenCalled();
        expect(queue.addRcsWebhook).not.toHaveBeenCalled();
      },
    );

    it('positive control: the same signed body with both envs opens campaign-status', async () => {
      process.env.PROVIDER_WEBHOOK_TOKEN = TOKEN;

      await http()
        .post('/api/webhook/campaign-status')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(rawBody))
        .send(rawBody)
        .expect(201);

      expect(queue.addMetaWebhook).toHaveBeenCalledTimes(1);
    });
  });

  describe('rollout: sem env, comportamento atual + aviso', () => {
    it('accepts without credentials and warns once per route', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await http().post('/api/webhook/rcs').send({ messageId: 'a', status: 'READ' }).expect(201);
      await http().post('/api/webhook/rcs').send({ messageId: 'b', status: 'READ' }).expect(201);

      expect(queue.addRcsWebhook).toHaveBeenCalledTimes(2);
      const unconfigured = warn.mock.calls.filter(([msg]) =>
        String(msg).includes('SEM autenticacao (rota=rcs)'),
      );
      expect(unconfigured).toHaveLength(1);
    });
  });

  describe('queue/stats e test fora do publico', () => {
    beforeEach(() => {
      process.env.BROADCAST_SERVICE_TOKEN = API_TOKEN;
      process.env.PROVIDER_WEBHOOK_TOKEN = TOKEN;
    });

    it('queue/stats and test require the API Bearer (provider token does not open them)', async () => {
      await http().get('/api/webhook/queue/stats').expect(401);
      await http().get('/api/webhook/queue/stats').set('X-Webhook-Token', TOKEN).expect(401);
      await http().post('/api/webhook/test').send({ ping: 1 }).expect(401);

      expect(queue.getQueueStats).not.toHaveBeenCalled();
    });

    it('positive control: with the API Bearer they answer', async () => {
      await http()
        .get('/api/webhook/queue/stats')
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .expect(200);
      await http()
        .post('/api/webhook/test')
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({ ping: 1 })
        .expect(201);

      expect(queue.getQueueStats).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * WA-01 (auditoria 26/10) — contrato do `broadcast:messageResults` com o CRM.
 *
 * O CRM decide o freio de emergencia (CampaignKillSwitch), a contencao
 * (CampaignFallbackService::handleFailures via CampaignErrorPolicy) e o resumo
 * de falhas pelo `errorCode` de cada item FAILED. Do lado PHP o codigo passa por
 * `CampaignErrorPolicy::normalize()`: int, ou string que satisfaz `ctype_digit`
 * ("131026"); qualquer outra coisa vira -1 e nada dispara.
 *
 * Mocks puros: nenhum Redis, Postgres ou rede.
 */
import { Logger } from '@nestjs/common';
import { BroadcastProcessor } from './broadcast.processor';
import { MetaApiError } from '../services/meta-error';
import { MessageResultItem } from '../services/campaign-webhook.service';

Logger.overrideLogger(false);

// Mesmo criterio do CampaignErrorPolicy::normalize() do CRM.
const crmNormalize = (code: unknown): number => {
  if (typeof code === 'number' && Number.isInteger(code)) return code;
  return typeof code === 'string' && /^\d+$/.test(code) ? parseInt(code, 10) : -1;
};

function build(sendMessage: jest.Mock, attempts = 1) {
  const row = {
    id: 'c1',
    status: 'PROCESSING',
    timeWindows: [],
    sentCount: 0,
    failedCount: 0,
    totalRecipients: 10,
    metadata: {},
    channel: '1-teste',
  };
  const prisma: any = {
    campaign: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    message: {
      create: jest.fn().mockResolvedValue({ id: 'm1' }),
      upsert: jest.fn().mockResolvedValue({ id: 'm1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    campaignRecipient: {
      findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'QUEUED' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));
  const webhook = {
    sendMessageResults: jest.fn().mockResolvedValue(undefined),
    sendBroadcastSummary: jest.fn().mockResolvedValue(undefined),
    sendUpdateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const dlq = { add: jest.fn().mockResolvedValue(undefined) };
  const processor = new BroadcastProcessor(
    prisma,
    { getDispatcher: () => ({ sendMessage }) } as any,
    webhook as any,
    dlq as any,
  );
  const job: any = {
    id: 'j1',
    data: {
      campaignId: 'c1',
      recipientId: 'r1',
      recipientPhone: '5511900000001',
      recipientName: 'Destinatario',
      recipientVariables: {},
      templateData: { id: 't1', name: 'tpl' },
      channel: '1-teste',
      templateName: 'tpl',
      templateLanguage: 'pt_BR',
    },
    attemptsMade: attempts - 1,
    opts: { attempts },
    moveToDelayed: jest.fn(),
  };
  return { processor, prisma, webhook, dlq, job };
}

async function onlyResultItem(
  sendMessage: jest.Mock,
  attempts = 1,
): Promise<{ item: MessageResultItem; prisma: any; dlq: any }> {
  const { processor, prisma, webhook, dlq, job } = build(sendMessage, attempts);
  await processor.process(job);
  expect(webhook.sendMessageResults).toHaveBeenCalledTimes(1);
  const [, items] = webhook.sendMessageResults.mock.calls[0];
  expect(items).toHaveLength(1);
  return { item: items[0], prisma, dlq };
}

const metaError = (metaCode: number, policy: 'permanent' | 'retry' = 'permanent') =>
  new MetaApiError({
    metaCode,
    metaMessage: `erro ${metaCode}`,
    httpStatusCode: 400,
    policy,
    rawPayload: {},
  });

describe('WA-01 — messageResults leva errorCode no formato que o CRM le', () => {
  it('fatal template error (132015) travels as the numeric string the kill switch expects', async () => {
    const { item, prisma, dlq } = await onlyResultItem(
      jest.fn().mockRejectedValue(metaError(132015)),
    );

    expect(item.status).toBe('FAILED');
    expect(item.errorCode).toBe('132015');
    expect(crmNormalize(item.errorCode)).toBe(132015);
    // Mesmo codigo que ja ia para o Message e para a DLQ.
    expect(prisma.message.create.mock.calls[0][0].data.errorCode).toBe('132015');
    expect(dlq.add.mock.calls[0][1].errorCode).toBe('132015');
  });

  it('recipient-level error (131026) travels so the CRM fallback can pick it up', async () => {
    const { item } = await onlyResultItem(jest.fn().mockRejectedValue(metaError(131026)));

    expect(item.errorCode).toBe('131026');
    expect(crmNormalize(item.errorCode)).toBe(131026);
  });

  it('retryable Meta error on the last attempt still carries the Meta code', async () => {
    const { item } = await onlyResultItem(
      jest.fn().mockRejectedValue(metaError(131000, 'retry')),
      3,
    );

    expect(item.errorCode).toBe('131000');
  });

  it('non-Meta HTTP failure carries the HTTP status as a numeric string', async () => {
    const httpError: any = new Error('Request failed with status code 404');
    httpError.response = { status: 404 };
    const { item } = await onlyResultItem(jest.fn().mockRejectedValue(httpError));

    expect(item.errorCode).toBe('404');
  });

  it('failure without Meta code nor HTTP status sends null, never the internal UNKNOWN marker', async () => {
    const { item, prisma } = await onlyResultItem(
      jest.fn().mockRejectedValue(new Error('socket hang up')),
      1,
    );

    // Controle positivo: o processo produziu o marcador interno...
    expect(prisma.message.create.mock.calls[0][0].data.errorCode).toBe('UNKNOWN');
    // ...mas ele nao vai para o CRM (la viraria -1 de qualquer jeito).
    expect(item).toHaveProperty('errorCode', null);
  });

  it('SENT item carries errorCode null so every item has the same shape', async () => {
    const { item } = await onlyResultItem(
      jest.fn().mockResolvedValue({ externalId: 'wamid.1', metadata: {} }),
    );

    expect(item.status).toBe('SENT');
    expect(item).toHaveProperty('errorCode', null);
  });
});

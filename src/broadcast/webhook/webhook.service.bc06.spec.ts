/* eslint-disable @typescript-eslint/require-await -- mocks do Prisma/fila devolvem promessas sem await */
/**
 * BC-06 / SEC-04 (auditoria de campanhas de 26/10/2026) — correlacao e ordem dos webhooks de
 * provedor no WebhookService. Mocks puros do Prisma: nenhum banco, nenhuma rede.
 *
 * Os dois `it` da reproducao da auditoria aparecem aqui invertidos (READ nao regride; wamid
 * desconhecido nao cai em campanha de outro tenant), cada um com o controle positivo ao lado.
 */
import { Logger } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { WebhookService, canTransitionMessageStatus } from './webhook.service';

Logger.overrideLogger(false);

type Row = Record<string, any>;

/** Avalia o `where` do Prisma que o servico usa (subconjunto suficiente para o teste). */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') {
      return (cond as Row[]).some((sub) => matches(row, sub));
    }
    if (key === 'createdAt') {
      return true;
    }
    if (key === 'campaign') {
      return matches(row.campaign ?? {}, cond);
    }
    if (cond && typeof cond === 'object') {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key]);
      if ('endsWith' in cond) return String(row[key] ?? '').endsWith(cond.endsWith);
      if ('equals' in cond) return row[key] === cond.equals;
    }
    return row[key] === cond;
  });
}

function makeService(
  opts: { messages?: Row[]; recipients?: Row[]; updateManyCount?: number } = {},
) {
  const messages = opts.messages ?? [];
  const recipients = opts.recipients ?? [];
  const updateManyCount = opts.updateManyCount ?? 1;

  const tx: any = {
    message: {
      findUnique: jest.fn(
        async ({ where }: any) => messages.find((m) => m.id === where.id) ?? null,
      ),
      update: jest.fn(async () => undefined),
      updateMany: jest.fn(async () => ({ count: updateManyCount })),
    },
    campaignRecipient: { update: jest.fn(async () => undefined) },
    campaign: { update: jest.fn(async () => undefined) },
  };

  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    message: {
      findFirst: jest.fn(async ({ where }: any) => messages.find((m) => matches(m, where)) ?? null),
      update: jest.fn(async () => undefined),
      updateMany: jest.fn(async () => ({ count: updateManyCount })),
    },
    campaignRecipient: {
      findFirst: jest.fn(
        async ({ where }: any) => recipients.find((r) => matches(r, where)) ?? null,
      ),
      update: jest.fn(async () => undefined),
    },
    campaign: { update: jest.fn(async () => undefined) },
    campaignResponse: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => undefined),
    },
    webhookEvent: {
      create: jest.fn(async () => ({ id: 'evt-1' })),
      update: jest.fn(async () => undefined),
    },
  };

  return { service: new WebhookService(prisma), prisma, tx };
}

function message(status: MessageStatus, extra: Row = {}): Row {
  return {
    id: 'm-1',
    campaignId: 'camp-1',
    recipientId: 'rcp-1',
    phoneNumber: '5511999990001',
    whatsappMessageId: 'wamid.1',
    externalId: 'wamid.1',
    providerMessageId: 'rcs-1',
    status,
    metadata: {},
    campaign: { id: 'camp-1', phoneNumberId: 'pn-1' },
    recipient: { id: 'rcp-1', campaignId: 'camp-1' },
    ...extra,
  };
}

const metadata = { display_phone_number: '551100000000', phone_number_id: 'pn-1' };

function metaStatus(status: string, id = 'wamid.1') {
  return { id, status, timestamp: '1900000000', recipient_id: '5511999990001' };
}

describe('canTransitionMessageStatus', () => {
  it.each([
    [undefined, 'SENT', true],
    ['SENT', 'DELIVERED', true],
    ['SENT', 'READ', true],
    ['DELIVERED', 'READ', true],
    ['SENT', 'FAILED', true],
    ['QUEUED', 'FAILED', true],
    ['READ', 'DELIVERED', false],
    ['READ', 'SENT', false],
    ['DELIVERED', 'SENT', false],
    ['DELIVERED', 'FAILED', false],
    ['READ', 'FAILED', false],
    ['FAILED', 'DELIVERED', false],
    ['FAILED', 'READ', false],
    ['REJECTED', 'SENT', false],
    ['DELIVERED', 'DELIVERED', false],
    ['FAILED', 'FAILED', false],
  ])('%s -> %s = %s', (previous, next, expected) => {
    expect(canTransitionMessageStatus(previous as MessageStatus, next as MessageStatus)).toBe(
      expected,
    );
  });
});

describe('BC-06 — status monotonico (Meta)', () => {
  it('late "delivered" after READ does not regress the message nor touch counters', async () => {
    const { service, prisma, tx } = makeService({ messages: [message('READ')] });

    await service.processMetaWebhook(metaStatus('delivered'), metadata);

    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.message.update).not.toHaveBeenCalled();
    expect(tx.campaignRecipient.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('positive control: "delivered" after SENT advances and counts once, in the transaction', async () => {
    const { service, prisma, tx } = makeService({ messages: [message('SENT')] });

    await service.processMetaWebhook(metaStatus('delivered'), metadata);

    expect(tx.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1', status: 'SENT' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
    expect(tx.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) }),
    );
    expect(tx.campaign.update).toHaveBeenCalledTimes(1);
    expect(tx.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { deliveredCount: { increment: 1 } },
    });
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('"failed" does not overwrite DELIVERED', async () => {
    const { service, tx } = makeService({ messages: [message('DELIVERED')] });

    await service.processMetaWebhook(metaStatus('failed'), metadata);

    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it('positive control: "failed" after SENT moves the message from sent to failed', async () => {
    const { service, tx } = makeService({ messages: [message('SENT')] });

    await service.processMetaWebhook(metaStatus('failed'), metadata);

    expect(tx.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(tx.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { sentCount: { decrement: 1 }, failedCount: { increment: 1 } },
    });
  });

  it('nothing moves after a terminal FAILED (late "read")', async () => {
    const { service, tx } = makeService({ messages: [message('FAILED')] });

    await service.processMetaWebhook(metaStatus('read'), metadata);

    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it('repeated event does not count twice', async () => {
    const { service, tx } = makeService({ messages: [message('DELIVERED')] });

    await service.processMetaWebhook(metaStatus('delivered'), metadata);

    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
  });

  it('concurrent worker already moved the message: conditional write hits 0 rows, no counters', async () => {
    const { service, tx } = makeService({ messages: [message('SENT')], updateManyCount: 0 });

    await service.processMetaWebhook(metaStatus('delivered'), metadata);

    expect(tx.message.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.campaignRecipient.update).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
  });
});

describe('BC-06 — correlacao de status so pelo id do provedor', () => {
  it('unknown wamid is ignored instead of hitting another campaign by phone', async () => {
    // A mensagem do MESMO telefone existe, em outra campanha: antes o fallback a achava.
    const otherCampaign = message('SENT', {
      id: 'm-old',
      campaignId: 'camp-OTHER',
      whatsappMessageId: 'wamid.old',
      externalId: 'wamid.old',
      campaign: { id: 'camp-OTHER', phoneNumberId: 'pn-1' },
    });
    const { service, prisma, tx } = makeService({ messages: [otherCampaign] });

    await service.processMetaWebhook(metaStatus('delivered', 'wamid.new'), metadata);

    expect(prisma.message.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.campaign.update).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('positive control: known wamid is processed', async () => {
    const { service, prisma, tx } = makeService({ messages: [message('SENT')] });

    await service.processMetaWebhook(metaStatus('delivered', 'wamid.1'), metadata);

    expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.message.updateMany).toHaveBeenCalledTimes(1);
  });

  it('RCS: unknown messageId is ignored even with a matching phone', async () => {
    const { service, prisma, tx } = makeService({ messages: [message('SENT')] });

    await service.processRcsWebhook({
      messageId: 'rcs-unknown',
      status: 'DELIVERED',
      phone: '5511999990001',
    });

    expect(prisma.message.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
  });

  it('RCS: event without messageId is ignored without querying by phone', async () => {
    const { service, prisma } = makeService({ messages: [message('SENT')] });

    await service.processRcsWebhook({ status: 'DELIVERED', phone: '5511999990001' });

    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('RCS positive control: known messageId advances; late DELIVERED after READ does not', async () => {
    const advancing = makeService({ messages: [message('SENT')] });
    await advancing.service.processRcsWebhook({ messageId: 'rcs-1', status: 'DELIVERED' });
    expect(advancing.tx.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-1', status: 'SENT' } }),
    );
    expect(advancing.tx.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { deliveredCount: { increment: 1 } },
    });

    const regressing = makeService({ messages: [message('READ')] });
    await regressing.service.processRcsWebhook({ messageId: 'rcs-1', status: 'DELIVERED' });
    expect(regressing.tx.message.updateMany).not.toHaveBeenCalled();
    expect(regressing.tx.campaign.update).not.toHaveBeenCalled();
  });

  it('Diogenes: late "messages.update" after READ is ignored; after SENT it advances', async () => {
    const diogenes = (id: string) => ({
      event: 'messages.update',
      instance: 'inst',
      data: { key: { remoteJid: 'x', fromMe: true, id } },
    });

    const regressing = makeService({ messages: [message('READ', { externalId: 'ext-1' })] });
    await regressing.service.processDiogenesWebhook(diogenes('ext-1'));
    expect(regressing.prisma.message.updateMany).not.toHaveBeenCalled();
    expect(regressing.prisma.campaign.update).not.toHaveBeenCalled();

    const advancing = makeService({ messages: [message('SENT', { externalId: 'ext-1' })] });
    await advancing.service.processDiogenesWebhook(diogenes('ext-1'));
    expect(advancing.prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-1', status: 'SENT' } }),
    );
    expect(advancing.prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { deliveredCount: { increment: 1 } },
    });
  });
});

describe('SEC-04 — resposta/opt-out por telefone fica no numero de envio do evento', () => {
  const optOutReply = (from: string) => ({
    id: 'wamid.reply',
    from,
    timestamp: '1900000000',
    type: 'text',
    text: { body: 'SAIR' },
  });

  function scenario(campaignPhoneNumberId: string | null) {
    const campaign = { id: 'camp-A', phoneNumberId: campaignPhoneNumberId };
    const recipient = {
      id: 'rcp-A',
      campaignId: 'camp-A',
      phoneNumber: '5511999990001',
      isActive: true,
      optedOut: false,
      campaign,
    };
    return makeService({
      messages: [
        message('DELIVERED', {
          id: 'm-A',
          campaignId: 'camp-A',
          recipientId: 'rcp-A',
          campaign,
          recipient,
        }),
      ],
      recipients: [recipient],
    });
  }

  it('reply without context from a number of another channel creates no response nor opt-out', async () => {
    const { service, prisma } = scenario('pn-OTHER-TENANT');

    await service.processMetaMessage(optOutReply('5511999990001'), metadata);

    expect(prisma.campaignResponse.create).not.toHaveBeenCalled();
    expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('positive control: same channel (phone_number_id) records the response and the opt-out', async () => {
    const { service, prisma } = scenario('pn-1');

    await service.processMetaMessage(optOutReply('5511999990001'), metadata);

    expect(prisma.campaignResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ campaignId: 'camp-A', recipientId: 'rcp-A' }),
      }),
    );
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rcp-A' },
        data: expect.objectContaining({ optedOut: true }),
      }),
    );
  });

  it('suffix of the phone no longer matches (exact equality only)', async () => {
    const { service, prisma } = scenario('pn-1');

    await service.processMetaMessage(optOutReply('0001'), metadata);

    expect(prisma.campaignResponse.create).not.toHaveBeenCalled();
    expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
  });

  it('campaign without phoneNumberId is not matched by phone (channel unknown)', async () => {
    const { service, prisma } = scenario(null);

    await service.processMetaMessage(optOutReply('5511999990001'), metadata);

    expect(prisma.campaignResponse.create).not.toHaveBeenCalled();
  });

  it('reply with context (wamid of the campaign message) still correlates', async () => {
    const { service, prisma } = scenario(null);

    await service.processMetaMessage(
      { ...optOutReply('5511999990001'), context: { id: 'wamid.1' } },
      metadata,
    );

    expect(prisma.campaignResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: 'camp-A' }) }),
    );
  });
});

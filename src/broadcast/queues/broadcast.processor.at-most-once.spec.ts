/**
 * BC-01 / BC-02 (auditoria 26/10) — envio no maximo uma vez por destinatario e
 * conclusao da campanha uma unica vez.
 *
 * Banco em memoria (mocks puros): campanha, recipients e messages, com o
 * externalId unico e os updates condicionais avaliados no momento da chamada.
 * Nada vai ao provedor: o dispatcher e um jest.fn.
 */
import { Logger } from '@nestjs/common';
import { BroadcastProcessor, SendMessageJob } from './broadcast.processor';
import { QueueService } from '../services/queue.service';

Logger.overrideLogger(false);

interface CampaignRow {
  id: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  deliveredCount: number;
  readCount: number;
  timeWindows: any[];
  completedAt: Date | null;
  metadata: any;
  channel: string;
}

function matchesStatus(current: string, filter: any): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return current === filter;
  if (filter.notIn) return !filter.notIn.includes(current);
  if (filter.in) return filter.in.includes(current);
  return true;
}

function applyData(row: any, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment;
    else if (value && typeof value === 'object' && 'decrement' in value) row[key] -= value.decrement;
    else row[key] = value;
  }
}

function makeWorld(
  opts: {
    totalRecipients?: number;
    recipients?: string[];
    /** Webhook do provedor que roda assim que a Message fica visivel (commit). */
    onMessageVisible?: (message: any) => void;
  } = {},
) {
  const campaign: CampaignRow = {
    id: 'camp-1',
    status: 'PROCESSING',
    totalRecipients: opts.totalRecipients ?? 2,
    sentCount: 0,
    failedCount: 0,
    deliveredCount: 0,
    readCount: 0,
    timeWindows: [],
    completedAt: null,
    metadata: {},
    channel: '7-tenant.example',
  };
  const recipients = new Map<string, { id: string; status: string; metadata?: any }>();
  for (const id of opts.recipients ?? ['rcp-A', 'rcp-B']) {
    recipients.set(id, { id, status: 'QUEUED' });
  }
  const messages: any[] = [];
  let seq = 0;
  // Transacao simulada: Message gravada pelo cliente DA TRANSACAO so fica
  // visivel ao webhook no commit; gravada pelo cliente global (mesmo durante
  // a transacao) fica visivel na hora, como no Postgres em READ COMMITTED.
  const pendingVisible: any[] = [];
  const becameVisible = (row: any, viaTx?: { tx: true }) => {
    if (viaTx?.tx) pendingVisible.push(row);
    else opts.onMessageVisible?.(row);
  };

  const prisma: any = {
    campaign: {
      findUnique: jest.fn(async () => ({ ...campaign })),
      update: jest.fn(async ({ data }: any) => {
        applyData(campaign, data);
        return { ...campaign };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== campaign.id || !matchesStatus(campaign.status, where.status)) {
          return { count: 0 };
        }
        applyData(campaign, data);
        return { count: 1 };
      }),
    },
    campaignRecipient: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const r = recipients.get(where.id);
        if (!r) return null;
        return {
          status: r.status,
          metadata: r.metadata ?? null,
          // Honra o filtro do select (externalId: { not: null }) como o Prisma.
          messages: messages
            .filter((m) => m.recipientId === r.id)
            .filter((m) => {
              const filter = select?.messages?.where?.externalId;
              // Coluna ausente = NULL no banco.
              if (filter && 'not' in filter && filter.not === null) return m.externalId != null;
              return true;
            })
            .slice(0, 1)
            .map((m) => ({ id: m.id, externalId: m.externalId })),
        };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = recipients.get(where.id)!;
        applyData(r, data);
        return { ...r };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = recipients.get(where.id);
        if (!r || !matchesStatus(r.status, where.status)) return { count: 0 };
        applyData(r, data);
        return { count: 1 };
      }),
      findMany: jest.fn(async () => []),
    },
    message: {
      create: jest.fn(async ({ data }: any, viaTx?: { tx: true }) => {
        if (data.externalId && messages.some((m) => m.externalId === data.externalId)) {
          throw new Error('P2002 unique externalId');
        }
        const row = { id: `msg-${++seq}`, ...data };
        messages.push(row);
        if (row.externalId) becameVisible(row, viaTx);
        return row;
      }),
      upsert: jest.fn(async ({ where, create }: any, viaTx?: { tx: true }) => {
        const existing = messages.find((m) => m.externalId === where.externalId);
        if (existing) return existing;
        const row = { id: `msg-${++seq}`, ...create };
        messages.push(row);
        becameVisible(row, viaTx);
        return row;
      }),
    },
  };
  // Cliente da transacao: as escritas de Message passam pelos mesmos jest.fn
  // (os testes podem fazer mockRejectedValueOnce neles), marcadas como "da tx".
  const txClient: any = {
    campaignRecipient: prisma.campaignRecipient,
    message: {
      create: (args: any) => prisma.message.create(args, { tx: true }),
      upsert: (args: any) => prisma.message.upsert(args, { tx: true }),
    },
  };
  // Sem rollback (os testes que falham na transacao falham antes de gravar).
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<any>, _options?: any) => {
    try {
      return await fn(txClient);
    } finally {
      pendingVisible.splice(0).forEach((row) => opts.onMessageVisible?.(row));
    }
  });

  const dispatcher = {
    channel: 'whatsapp',
    sendMessage: jest.fn(async (job: SendMessageJob) => ({
      success: true,
      externalId: `wamid.${job.recipientId}.${dispatcher.sendMessage.mock.calls.length}`,
      status: 'SENT',
      metadata: {},
    })),
  };
  const webhook: any = {
    sendBroadcastSummary: jest.fn(async () => undefined),
    sendUpdateStatus: jest.fn(async () => undefined),
    sendMessageResults: jest.fn(async () => undefined),
  };
  const dlq: any = { add: jest.fn(async () => undefined) };
  const queueService: any = {
    pauseQueue: jest.fn(async () => undefined),
    resumeQueue: jest.fn(async () => undefined),
  };
  const processor = new BroadcastProcessor(
    prisma,
    { getDispatcher: jest.fn(() => dispatcher) } as any,
    webhook,
    dlq,
    queueService,
  );

  const sentResults = () =>
    webhook.sendMessageResults.mock.calls
      .flatMap((c: any[]) => c[1])
      .filter((i: any) => i.status === 'SENT');

  return { campaign, recipients, messages, prisma, dispatcher, webhook, dlq, processor, sentResults };
}

function makeJob(recipientId: string, phone: string, attemptsMade = 0): any {
  return {
    id: `job-${recipientId}-${attemptsMade}`,
    data: {
      campaignId: 'camp-1',
      recipientId,
      recipientPhone: phone,
      recipientName: 'Contato Teste',
      recipientVariables: { '1': 'Contato' },
      templateData: { id: 'tpl-1', name: 'tpl', language: 'pt_BR', components: [] },
      channel: '7-tenant.example',
      templateName: 'tpl',
      templateLanguage: 'pt_BR',
    } as SendMessageJob,
    attemptsMade,
    opts: { attempts: 3 },
    moveToDelayed: jest.fn(async () => undefined),
  };
}

/** Roda process() avancando o sleep de 5s da conclusao. */
async function run(processor: BroadcastProcessor, job: any) {
  const pending = processor.process(job);
  await jest.advanceTimersByTimeAsync(6000);
  return pending;
}

describe('BC-01 — no maximo um envio por destinatario', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not resend nor mark FAILED when persistence fails after the provider accepted', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    w.prisma.message.upsert.mockRejectedValueOnce(new Error('ECONNRESET (db)'));

    const first = await run(w.processor, makeJob('rcp-A', '5500000000001', 0));

    // O aceite nao vira erro para o BullMQ (relancar = reenviar).
    expect(first).toMatchObject({ success: true });
    expect(w.dispatcher.sendMessage).toHaveBeenCalledTimes(1);
    expect(w.recipients.get('rcp-A')!.status).toBe('SENT');
    expect(w.messages.filter((m) => m.status === 'FAILED')).toHaveLength(0);

    // Uma segunda execucao do mesmo destinatario (retry/stalled/duplicado) nao envia.
    const again = await run(w.processor, makeJob('rcp-A', '5500000000001', 1));
    expect(again).toMatchObject({ skipped: true, reason: 'recipient_already_processed' });
    expect(w.dispatcher.sendMessage).toHaveBeenCalledTimes(1);
    expect(w.campaign.sentCount).toBe(1);
  });

  it('a failure after the counter neither double counts nor completes early, and the next recipient is sent', async () => {
    const w = makeWorld({ totalRecipients: 2 });
    // Na 1a execucao a leitura da campanha do webhook de progresso cai.
    let calls = 0;
    w.prisma.campaign.findUnique.mockImplementation(async () => {
      calls += 1;
      if (calls === 3) throw new Error('db timeout');
      return { ...w.campaign };
    });

    await expect(run(w.processor, makeJob('rcp-A', '5500000000001', 0))).resolves.toMatchObject({
      success: true,
    });
    w.prisma.campaign.findUnique.mockImplementation(async () => ({ ...w.campaign }));

    // Retry do mesmo destinatario: descartado, sem reenvio e sem contar de novo.
    await run(w.processor, makeJob('rcp-A', '5500000000001', 1));
    expect(w.campaign.sentCount).toBe(1);
    expect(w.campaign.status).toBe('PROCESSING');

    // O segundo destinatario continua elegivel e conclui a campanha.
    await expect(run(w.processor, makeJob('rcp-B', '5500000000002', 0))).resolves.toMatchObject({
      success: true,
    });
    const phonesSent = w.dispatcher.sendMessage.mock.calls.map((c) => c[0].recipientPhone);
    expect(phonesSent).toEqual(['5500000000001', '5500000000002']);
    expect(w.campaign.sentCount).toBe(2);
    expect(w.campaign.status).toBe('COMPLETED');
  });

  it('counts the send exactly once when the provider webhook lands right after the Message is written', async () => {
    // Webhook "delivered" (Meta, webhook.service.ts:220) ou messages.upsert do
    // Diogenes: acha a Message pelo externalId e leva o recipient a DELIVERED.
    // Nao soma sentCount (a Message ja estava SENT) — so deliveredCount.
    let w!: ReturnType<typeof makeWorld>;
    w = makeWorld({
      totalRecipients: 1,
      recipients: ['rcp-A'],
      onMessageVisible: (message) => {
        message.status = 'DELIVERED';
        w.recipients.get(message.recipientId)!.status = 'DELIVERED';
        w.campaign.deliveredCount += 1;
      },
    });

    await run(w.processor, makeJob('rcp-A', '5500000000001', 0));

    expect(w.campaign.sentCount).toBe(1);
    expect(w.campaign.status).toBe('COMPLETED');
    expect(w.recipients.get('rcp-A')!.status).toBe('DELIVERED');
    expect(w.sentResults()).toHaveLength(1);
  });

  it('waits up to 10s for a pool connection before giving up on the acceptance write', async () => {
    const w = makeWorld({ totalRecipients: 5 });

    await run(w.processor, makeJob('rcp-A', '5500000000001', 0));

    // maxWait padrao do Prisma (2s) estoura com 100 jobs por processo no pool.
    expect(w.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ maxWait: 10_000, timeout: 10_000 }),
    );
  });

  it('a failed acceptance write leaves no Message behind and is not resent nor counted twice', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    // Banco fora nas 3 tentativas da transacao.
    w.prisma.$transaction.mockRejectedValue(new Error('ECONNREFUSED (db)'));

    const result = await run(w.processor, makeJob('rcp-A', '5500000000001', 0));

    expect(result).toMatchObject({ success: true });
    expect(w.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(w.dispatcher.sendMessage).toHaveBeenCalledTimes(1);
    expect(w.recipients.get('rcp-A')!.status).toBe('QUEUED');
    expect(w.campaign.sentCount).toBe(0);
  });

  it('rethrows for a retry when the final FAILED cannot be written, instead of leaving it uncounted', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    const permanent: any = new Error('Request failed with status code 400');
    permanent.response = { status: 400 };
    w.dispatcher.sendMessage.mockRejectedValue(permanent);
    w.prisma.campaignRecipient.updateMany.mockRejectedValue(new Error('ECONNREFUSED (db)'));

    const pending = w.processor.process(makeJob('rcp-A', '5500000000001', 0));
    const assertion = expect(pending).rejects.toBe(permanent);
    await jest.advanceTimersByTimeAsync(6000);
    await assertion;

    expect(w.prisma.campaignRecipient.updateMany).toHaveBeenCalledTimes(3);
    expect(w.campaign.failedCount).toBe(0);
    expect(w.dlq.add).not.toHaveBeenCalled();
  });

  it('reconciles an accepted message whose recipient was left QUEUED without calling the provider', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    w.messages.push({ id: 'msg-old', recipientId: 'rcp-A', externalId: 'wamid.old', status: 'SENT' });

    const result = await run(w.processor, makeJob('rcp-A', '5500000000001', 0));

    expect(w.dispatcher.sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, reconciled: true, externalId: 'wamid.old' });
    expect(w.recipients.get('rcp-A')!.status).toBe('SENT');
    expect(w.campaign.sentCount).toBe(1);
    expect(w.sentResults()).toHaveLength(1);
  });

  it('positive control: a genuine temporary failure keeps the recipient QUEUED and the retry does send', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    w.dispatcher.sendMessage.mockRejectedValueOnce(new Error('timeout de rede'));

    // Tentativa intermediaria nao chega na conclusao (sem o sleep de 5s).
    await expect(
      w.processor.process(makeJob('rcp-A', '5500000000001', 0)),
    ).rejects.toThrow('timeout de rede');
    expect(w.recipients.get('rcp-A')!.status).toBe('QUEUED');
    expect(w.messages.filter((m) => m.status === 'FAILED')).toHaveLength(1);

    await expect(run(w.processor, makeJob('rcp-A', '5500000000001', 1))).resolves.toMatchObject({
      success: true,
    });
    expect(w.dispatcher.sendMessage).toHaveBeenCalledTimes(2);
    expect(w.recipients.get('rcp-A')!.status).toBe('SENT');
    expect(w.campaign.sentCount).toBe(1);
    expect(w.campaign.failedCount).toBe(0);
  });

  it('counts a recipient once even when two jobs for it race past the read', async () => {
    const w = makeWorld({ totalRecipients: 5 });

    // Dois jobs do mesmo destinatario em paralelo (ex.: job antigo + requeue):
    // ambos leem QUEUED antes de qualquer escrita.
    const pA = w.processor.process(makeJob('rcp-A', '5500000000001', 0));
    const pB = w.processor.process(makeJob('rcp-A', '5500000000001', 0));
    await jest.advanceTimersByTimeAsync(6000);
    await Promise.all([pA, pB]);

    expect(w.campaign.sentCount).toBe(1);
    expect(w.sentResults()).toHaveLength(1);
  });

  it('counts a final failure once even when two jobs for the recipient race', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    const permanent: any = new Error('Request failed with status code 400');
    permanent.response = { status: 400 };
    w.dispatcher.sendMessage.mockRejectedValue(permanent);

    const pA = w.processor.process(makeJob('rcp-A', '5500000000001', 0));
    const pB = w.processor.process(makeJob('rcp-A', '5500000000001', 0));
    await jest.advanceTimersByTimeAsync(6000);
    await Promise.all([pA, pB]);

    expect(w.recipients.get('rcp-A')!.status).toBe('FAILED');
    expect(w.recipients.get('rcp-A')!.metadata).toMatchObject({ finalFailure: true });
    expect(w.campaign.failedCount).toBe(1);
  });
});

describe('BC-01 — retry em voo do codigo anterior (compatibilidade de deploy)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // O catch antigo gravava FAILED ja na tentativa intermediaria, com attemptNumber.
  const legacyIntermediate = { status: 'FAILED', metadata: { attemptNumber: 0, errorCode: '500' } };

  it('retries a recipient left FAILED by an intermediate attempt of the previous code', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    Object.assign(w.recipients.get('rcp-A')!, legacyIntermediate);

    const result = await run(w.processor, makeJob('rcp-A', '5500000000001', 1));

    expect(result).toMatchObject({ success: true });
    expect(w.dispatcher.sendMessage).toHaveBeenCalledTimes(1);
    expect(w.recipients.get('rcp-A')!.status).toBe('SENT');
    expect(w.campaign.sentCount).toBe(1);
  });

  it('counts the legacy recipient as failed when the retry also fails for good', async () => {
    const w = makeWorld({ totalRecipients: 5 });
    Object.assign(w.recipients.get('rcp-A')!, legacyIntermediate);
    w.dispatcher.sendMessage.mockRejectedValue(new Error('timeout de rede'));

    await run(w.processor, makeJob('rcp-A', '5500000000001', 2)); // ultima tentativa

    expect(w.recipients.get('rcp-A')!.metadata).toMatchObject({ finalFailure: true });
    expect(w.campaign.failedCount).toBe(1);
  });

  it.each([
    [
      'final failure of this code',
      { status: 'FAILED', metadata: { attemptNumber: 0, finalFailure: true } },
      1,
    ],
    ['FAILED from the provider webhook', { status: 'FAILED', metadata: null }, 1],
    ['legacy FAILED seen by a first attempt', legacyIntermediate, 0],
  ])('does not resend for %s', async (_label, state, attemptsMade) => {
    const w = makeWorld({ totalRecipients: 5 });
    Object.assign(w.recipients.get('rcp-A')!, state);

    const result = await run(w.processor, makeJob('rcp-A', '5500000000001', attemptsMade));

    expect(result).toMatchObject({ skipped: true, reason: 'recipient_already_processed' });
    expect(w.dispatcher.sendMessage).not.toHaveBeenCalled();
  });
});

describe('BC-02 — conclusao condicional', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('completes once and sends the final webhooks once when two jobs see the total reached', async () => {
    const w = makeWorld({ totalRecipients: 2 });
    // Leitura concorrente: os dois jobs veem sent+failed >= total em PROCESSING.
    w.prisma.campaign.findUnique.mockImplementation(async () => ({
      ...w.campaign,
      status: 'PROCESSING',
      sentCount: 2,
      failedCount: 0,
    }));

    const pA = w.processor.process(makeJob('rcp-A', '5500000000001'));
    const pB = w.processor.process(makeJob('rcp-B', '5500000000002'));
    await jest.advanceTimersByTimeAsync(6000);
    await Promise.all([pA, pB]);

    expect(w.campaign.status).toBe('COMPLETED');
    const completions = [
      ...w.prisma.campaign.update.mock.calls,
      ...w.prisma.campaign.updateMany.mock.calls,
    ].filter((c) => c[0]?.data?.status === 'COMPLETED');
    // Duas tentativas de transicao, uma so efetiva.
    expect(completions.length).toBeGreaterThanOrEqual(1);
    const finalSummaries = w.webhook.sendBroadcastSummary.mock.calls.filter(
      (c: any[]) => c[1]?.status === 'COMPLETED',
    );
    expect(finalSummaries).toHaveLength(1);
    expect(w.webhook.sendUpdateStatus).toHaveBeenCalledTimes(1);
  });
});

describe('BC-01 — enfileiramento deduplicado por destinatario', () => {
  function makeQueueService(campaignOverrides: Record<string, any> = {}) {
    const queue: any = { addBulk: jest.fn(async () => []) };
    const campaign = {
      id: 'camp-1',
      name: 'C',
      channel: '7-tenant.example',
      templateId: 'tpl',
      templateData: { name: 'tpl', language: 'pt_BR' },
      batchSize: 10,
      delayBetweenBatches: 0,
      timeWindows: [],
      distributeEvenly: false,
      ...campaignOverrides,
    };
    const prisma: any = {
      campaign: { findUnique: jest.fn(async () => campaign) },
      campaignRecipient: {
        findMany: jest.fn(async () => [
          { id: 'rcp-A', phoneNumber: '5500000000001', name: 'A', metadata: null, variables: null },
          { id: 'rcp-B', phoneNumber: '5500000000002', name: 'B', metadata: null, variables: null },
        ]),
        updateMany: jest.fn(async () => ({ count: 2 })),
        update: jest.fn(async () => ({})),
      },
    };
    return { service: new QueueService(queue, prisma), queue };
  }

  it.each([
    ['batch', {}],
    [
      'distribute evenly',
      {
        distributeEvenly: true,
        timeWindows: [{ startTime: '00:00', endTime: '23:59', timezone: 'America/Sao_Paulo' }],
      },
    ],
  ])('every send job carries the per-recipient deduplication id (%s)', async (_label, overrides) => {
    const { service, queue } = makeQueueService(overrides);

    await service.enqueueCampaign('camp-1');

    const jobs = queue.addBulk.mock.calls[0][0];
    expect(jobs.map((j: any) => j.opts.deduplication)).toEqual([
      { id: 'send-camp-1-rcp-A' },
      { id: 'send-camp-1-rcp-B' },
    ]);
    // Sem jobId fixo: um job falho retido (removeOnFail 24h) nao pode
    // bloquear o requeue do mesmo destinatario.
    expect(jobs.every((j: any) => j.opts.jobId === undefined)).toBe(true);
  });
});

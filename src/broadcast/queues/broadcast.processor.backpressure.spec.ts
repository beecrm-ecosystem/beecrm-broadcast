/**
 * BC-04 / BC-11 (auditoria 26/10) — rate limit e breaker atrasam so o job do
 * canal afetado (moveToDelayed com token + DelayedError), sem pausar a fila
 * de todos os tenants, sem consumir `attempts` e sem perder o destinatario.
 *
 * Mocks puros: nenhum Redis, Postgres ou rede.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DelayedError } from 'bullmq';
import { of, throwError } from 'rxjs';
import {
  BroadcastProcessor,
  MAX_BACKPRESSURE_DEFERRALS,
  SendMessageJob,
} from './broadcast.processor';
import { QueueService } from '../services/queue.service';
import { DiogenesService } from '../services/diogenes.service';

Logger.overrideLogger(false);

const RATE_LIMIT = 'BACKPRESSURE: pause enqueue (meta=130429; Rate limit hit)';

function makeWorld(campaignOverrides: Record<string, any> = {}) {
  const campaign: any = {
    id: 'camp-1',
    status: 'PROCESSING',
    totalRecipients: 5,
    sentCount: 0,
    failedCount: 0,
    timeWindows: [],
    metadata: {},
    channel: '7-tenant.example',
    ...campaignOverrides,
  };
  const recipients = new Map<string, any>([
    ['rcp-A', { id: 'rcp-A', status: 'QUEUED' }],
    ['rcp-B', { id: 'rcp-B', status: 'QUEUED' }],
  ]);
  const messages: any[] = [];
  const apply = (row: any, data: any) => {
    for (const [k, v] of Object.entries<any>(data)) {
      row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
    }
  };
  const prisma: any = {
    campaign: {
      findUnique: jest.fn(async () => ({ ...campaign })),
      update: jest.fn(async ({ data }: any) => (apply(campaign, data), { ...campaign })),
      updateMany: jest.fn(async ({ data }: any) => (apply(campaign, data), { count: 1 })),
    },
    campaignRecipient: {
      findUnique: jest.fn(async ({ where }: any) => ({
        status: recipients.get(where.id).status,
        messages: [],
      })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = recipients.get(where.id);
        if (where.status?.notIn?.includes(r.status)) return { count: 0 };
        apply(r, data);
        return { count: 1 };
      }),
      findMany: jest.fn(async () => []),
    },
    message: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `msg-${messages.length + 1}`, ...data };
        messages.push(row);
        return row;
      }),
      upsert: jest.fn(async ({ create }: any) => {
        const row = { id: `msg-${messages.length + 1}`, ...create };
        messages.push(row);
        return row;
      }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));
  const dispatcher = {
    sendMessage: jest.fn(async (job: SendMessageJob) => ({
      success: true,
      externalId: `wamid.${job.recipientId}`,
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
  const processor = new BroadcastProcessor(
    prisma,
    { getDispatcher: () => dispatcher } as any,
    webhook,
    dlq,
  );
  return { campaign, recipients, messages, prisma, dispatcher, webhook, dlq, processor };
}

function makeJob(
  recipientId: string,
  opts: { attemptsMade?: number; channel?: string; deferrals?: number } = {},
): any {
  const job: any = {
    id: `job-${recipientId}`,
    data: {
      campaignId: 'camp-1',
      recipientId,
      recipientPhone: `55000000000${recipientId === 'rcp-A' ? 1 : 2}`,
      recipientName: 'Contato',
      recipientVariables: {},
      templateData: { id: 'tpl-1', name: 'tpl' },
      channel: opts.channel ?? '7-tenant.example',
      templateName: 'tpl',
      templateLanguage: 'pt_BR',
      ...(opts.deferrals !== undefined ? { backpressureDeferrals: opts.deferrals } : {}),
    } as SendMessageJob,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: 3 },
    moveToDelayed: jest.fn(async () => undefined),
    updateData: jest.fn(async (data: any) => {
      job.data = data;
    }),
  };
  return job;
}

describe('BC-04 — backpressure por job/canal, sem pausa global', () => {
  it('defers only this job with the worker token on the last attempt, without losing the recipient', async () => {
    const w = makeWorld();
    w.dispatcher.sendMessage.mockRejectedValueOnce(new Error(RATE_LIMIT));
    const job = makeJob('rcp-A', { attemptsMade: 2 }); // ultima das 3 attempts
    const before = Date.now();

    await expect(w.processor.process(job, 'tok-1')).rejects.toBeInstanceOf(DelayedError);

    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ backpressureDeferrals: 1 }),
    );
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    const [ts, token] = job.moveToDelayed.mock.calls[0];
    expect(token).toBe('tok-1');
    expect(ts).toBeGreaterThanOrEqual(before + 60_000);
    // Nada gravado como falha: o destinatario segue pendente para a volta do job.
    expect(w.recipients.get('rcp-A').status).toBe('QUEUED');
    expect(w.messages).toHaveLength(0);
    expect(w.dlq.add).not.toHaveBeenCalled();

    // Quando o job volta (mesmas attempts, contador de adiamento no data), envia.
    await expect(w.processor.process(job, 'tok-2')).resolves.toMatchObject({ success: true });
    expect(w.recipients.get('rcp-A').status).toBe('SENT');
  });

  it('uses the wait announced by the open channel breaker', async () => {
    const w = makeWorld();
    w.dispatcher.sendMessage.mockRejectedValueOnce(
      new Error(
        'Circuit breaker aberto para Diogenes (7-tenant.example; meta=130429). Aguarde 180000ms',
      ),
    );
    const job = makeJob('rcp-A');
    const before = Date.now();

    await expect(w.processor.process(job, 'tok')).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed.mock.calls[0][0]).toBeGreaterThanOrEqual(before + 180_000);
  });

  it('marks the recipient FAILED with the Meta code once the deferral budget is exhausted', async () => {
    const w = makeWorld();
    w.dispatcher.sendMessage.mockRejectedValueOnce(new Error(RATE_LIMIT));
    const job = makeJob('rcp-A', { deferrals: MAX_BACKPRESSURE_DEFERRALS });

    const result = await w.processor.process(job, 'tok');

    expect(result).toMatchObject({ success: false, permanent: true });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(w.recipients.get('rcp-A').status).toBe('FAILED');
    expect(w.campaign.failedCount).toBe(1);
    expect(w.dlq.add).toHaveBeenCalledWith(
      'failed-message',
      expect.objectContaining({ recipientId: 'rcp-A', errorCode: '130429' }),
      expect.anything(),
    );
    const items = w.webhook.sendMessageResults.mock.calls.flatMap((c: any[]) => c[1]);
    expect(items).toEqual([
      expect.objectContaining({ status: 'FAILED', errorCode: '130429' }),
    ]);
  });

  it('exhausting the budget on an open breaker still sends a rate code to the CRM', async () => {
    const w = makeWorld();
    w.dispatcher.sendMessage.mockRejectedValueOnce(
      new Error('Circuit breaker aberto para Diogenes (7-tenant.example; http=429). Aguarde 5000ms'),
    );
    const job = makeJob('rcp-A', { deferrals: MAX_BACKPRESSURE_DEFERRALS });

    await w.processor.process(job, 'tok');

    const items = w.webhook.sendMessageResults.mock.calls.flatMap((c: any[]) => c[1]);
    // 429 sem codigo da Meta vira 130429, que o CampaignErrorPolicy trata como ritmo.
    expect(items).toEqual([expect.objectContaining({ status: 'FAILED', errorCode: '130429' })]);
  });

  it('an ambiguous 5xx is not deferred: it consumes attempts like any temporary error', async () => {
    const w = makeWorld();
    const gateway: any = new Error('Request failed with status code 502');
    gateway.response = { status: 502 };
    w.dispatcher.sendMessage.mockRejectedValue(gateway);

    const first = makeJob('rcp-A', { attemptsMade: 0 });
    await expect(w.processor.process(first, 'tok')).rejects.toBe(gateway);
    expect(first.moveToDelayed).not.toHaveBeenCalled();
    expect(first.updateData).not.toHaveBeenCalled();

    // Na ultima das 3 attempts vira falha final: no maximo 3 envios, nao 31.
    const last = makeJob('rcp-A', { attemptsMade: 2 });
    await expect(w.processor.process(last, 'tok')).resolves.toMatchObject({ success: false });
    expect(last.moveToDelayed).not.toHaveBeenCalled();
    expect(w.recipients.get('rcp-A').status).toBe('FAILED');
    expect(w.dlq.add).toHaveBeenCalledWith(
      'failed-message',
      expect.objectContaining({ errorCode: '502' }),
      expect.anything(),
    );
  });

  it('a BACKPRESSURE without proof that nothing was sent is not deferred', async () => {
    const w = makeWorld();
    w.dispatcher.sendMessage.mockRejectedValueOnce(new Error('BACKPRESSURE: pause enqueue'));
    const job = makeJob('rcp-A');

    await expect(w.processor.process(job, 'tok')).rejects.toThrow('BACKPRESSURE');
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it('the processor has no handle to pause the shared queue', () => {
    const deps: any[] = Reflect.getMetadata('design:paramtypes', BroadcastProcessor) ?? [];
    expect(deps).not.toContain(QueueService);
    // Controle positivo: a leitura de metadata funciona para este provider.
    expect(deps.length).toBeGreaterThan(0);
  });
});

describe('BC-11 — moveToDelayed com token e DelayedError', () => {
  it('paused campaign: delays with the worker token and signals DelayedError', async () => {
    const w = makeWorld({ status: 'PAUSED' });
    const job = makeJob('rcp-A');

    await expect(w.processor.process(job, 'tok-9')).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok-9');
    expect(w.dispatcher.sendMessage).not.toHaveBeenCalled();
  });

  it('outside the time window: delays with the worker token and signals DelayedError', async () => {
    // Janela de 1 minuto 12h a frente do horario atual: sempre fora.
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const start = (now.getHours() + 12) % 24;
    const hh = String(start).padStart(2, '0');
    const w = makeWorld({
      timeWindows: [{ templateName: 'tpl', startTime: `${hh}:00`, endTime: `${hh}:01` }],
    });
    const job = makeJob('rcp-A');

    await expect(w.processor.process(job, 'tok-7')).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok-7');
    expect(w.dispatcher.sendMessage).not.toHaveBeenCalled();
  });
});

describe('BC-04 — breaker do Diogenes por canal', () => {
  const rateLimited = { data: { code: 130429, message: 'Rate limit hit' }, status: 200 };
  const accepted = { data: { key: { id: 'wamid.ok' } }, status: 200 };
  const payload: any = { number: '5500000000001', name: 'tpl', language: 'pt_BR' };

  it('rate limit on one channel does not block another channel', async () => {
    const http: any = { post: jest.fn() };
    http.post.mockReturnValueOnce(of(rateLimited)).mockReturnValue(of(accepted));
    const diogenes = new DiogenesService(http);

    await expect(diogenes.sendTemplate('1-tenant-a', payload)).rejects.toThrow('BACKPRESSURE');

    // Outro canal segue enviando...
    await expect(diogenes.sendTemplate('2-tenant-b', payload)).resolves.toMatchObject({
      key: { id: 'wamid.ok' },
    });
    // ...e o canal limitado fica com o breaker aberto (controle positivo).
    await expect(diogenes.sendTemplate('1-tenant-a', payload)).rejects.toThrow(
      /^Circuit breaker aberto/,
    );
    expect(http.post).toHaveBeenCalledTimes(2);
  });
});

describe('BC-04 — Diogenes: o que adia e o que consome attempts', () => {
  const payload: any = { number: '5500000000001', name: 'tpl', language: 'pt_BR' };
  const httpError = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data: {}, headers: {} },
    });

  function makeDiogenes(http: any) {
    const diogenes = new DiogenesService(http);
    (diogenes as any).delay = jest.fn(async () => undefined); // backoff adaptativo
    return diogenes;
  }

  it('5xx is rethrown as is (ambiguous), 429 becomes BACKPRESSURE with http=429', async () => {
    const http: any = {
      post: jest
        .fn()
        .mockReturnValueOnce(throwError(() => httpError(502)))
        .mockReturnValueOnce(throwError(() => httpError(429))),
    };
    const diogenes = makeDiogenes(http);

    const gateway = await diogenes.sendTemplate('1-a', payload).catch((e) => e);
    expect(gateway.message).not.toMatch(/BACKPRESSURE/);
    expect(gateway.response.status).toBe(502);

    await expect(diogenes.sendTemplate('2-b', payload)).rejects.toThrow(
      'BACKPRESSURE: pause enqueue (http=429)',
    );
  });

  it('the open breaker names the Meta code that opened it', async () => {
    const http: any = {
      post: jest.fn().mockReturnValue(of({ data: { code: 130429, message: 'Rate' }, status: 200 })),
    };
    const diogenes = makeDiogenes(http);

    await expect(diogenes.sendTemplate('1-a', payload)).rejects.toThrow('meta=130429');
    await expect(diogenes.sendTemplate('1-a', payload)).rejects.toThrow(
      /^Circuit breaker aberto para Diogenes \(1-a; meta=130429\)/,
    );
  });

  it('a success closes the channel breaker (the cooldown ladder starts over)', async () => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const rateLimited = of({ data: { code: 130429, message: 'Rate' }, status: 200 });
      const http: any = {
        post: jest
          .fn()
          .mockReturnValueOnce(rateLimited)
          .mockReturnValueOnce(of({ data: { key: { id: 'wamid.ok' } }, status: 200 }))
          .mockReturnValueOnce(rateLimited),
      };
      const diogenes = makeDiogenes(http);

      await expect(diogenes.sendTemplate('1-a', payload)).rejects.toThrow('BACKPRESSURE');
      now += 61_000; // passou o cooldown de 60s: HALF_OPEN
      await expect(diogenes.sendTemplate('1-a', payload)).resolves.toMatchObject({
        key: { id: 'wamid.ok' },
      });
      await expect(diogenes.sendTemplate('1-a', payload)).rejects.toThrow('BACKPRESSURE');

      // Breaker fechado pelo sucesso: o novo disparo recomeca em 60s (sem o
      // sucesso, seria o 2o degrau, 120s).
      await expect(diogenes.sendTemplate('1-a', payload)).rejects.toThrow('Aguarde 60000ms');
    } finally {
      clock.mockRestore();
    }
  });
});

describe('BC-04 — fila pausada pelo mecanismo antigo e retomada', () => {
  it.each([
    [true, 1],
    [false, 0],
  ])('resumeIfPaused (paused=%s) resumes %i time(s)', async (paused, resumes) => {
    const queue: any = {
      isPaused: jest.fn(async () => paused),
      resume: jest.fn(async () => undefined),
    };
    const service = new QueueService(queue, {} as any);

    await expect(service.resumeIfPaused()).resolves.toEqual({ wasPaused: paused });
    expect(queue.resume).toHaveBeenCalledTimes(resumes);
  });
});

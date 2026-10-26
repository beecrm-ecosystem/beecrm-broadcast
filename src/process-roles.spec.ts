/**
 * BC-10 (auditoria 26/10) — a API nao consome as filas e os dois entry points
 * encerram com app.close() em SIGINT (padrao do PM2) e SIGTERM.
 *
 * Sem Nest de pe, sem Redis: so metadata dos modulos e um alvo de sinais falso.
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { BroadcastModule, QUEUE_CONSUMERS } from './broadcast/broadcast.module';
import { BroadcastProcessor } from './broadcast/queues/broadcast.processor';
import { registerGracefulShutdown, SHUTDOWN_SIGNALS } from './shutdown';

Logger.overrideLogger(false);

const PROCESSOR_METADATA = 'bullmq:processor_metadata';
const isProcessor = (provider: any) =>
  typeof provider === 'function' && Reflect.hasMetadata(PROCESSOR_METADATA, provider);

/** Providers efetivos do BroadcastModule importado por um AppModule dinamico. */
function broadcastProviders(app: { imports?: any[] }): any[] {
  const dynamic = (app.imports ?? []).find((m: any) => m?.module === BroadcastModule);
  expect(dynamic).toBeDefined();
  const staticProviders: any[] = Reflect.getMetadata('providers', BroadcastModule) ?? [];
  return [...staticProviders, ...(dynamic.providers ?? [])];
}

describe('BC-10 — papeis dos processos', () => {
  it('every queue consumer is a BullMQ @Processor (positive control for the checks below)', () => {
    expect(QUEUE_CONSUMERS.length).toBe(6);
    expect(QUEUE_CONSUMERS.every(isProcessor)).toBe(true);
  });

  it('the API module registers no @Processor', () => {
    const providers = broadcastProviders(AppModule.forApi({}));

    expect(providers.length).toBeGreaterThan(0);
    expect(providers.filter(isProcessor)).toEqual([]);
  });

  it('the worker module registers every queue consumer', () => {
    const providers = broadcastProviders(AppModule.forWorker());

    expect(providers).toEqual(expect.arrayContaining(QUEUE_CONSUMERS));
    expect(providers).toContain(BroadcastProcessor);
  });

  it('the API consumes the queues only with the explicit escape flag', () => {
    const providers = broadcastProviders(
      AppModule.forApi({ BROADCAST_API_CONSUMES_QUEUES: 'true' }),
    );

    expect(providers).toContain(BroadcastProcessor);
  });

  it('both entry points boot through their role and register the shutdown handler', () => {
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    const worker = readFileSync(join(__dirname, 'worker.ts'), 'utf8');

    expect(main).toContain('AppModule.forApi()');
    expect(main).toContain('registerGracefulShutdown(app');
    expect(worker).toContain('AppModule.forWorker()');
    expect(worker).toContain('registerGracefulShutdown(app');
  });
});

describe('BC-10 — encerramento gracioso', () => {
  function fakeTarget() {
    const listeners = new Map<string, (signal: NodeJS.Signals) => void>();
    return {
      listeners,
      on: jest.fn((signal: NodeJS.Signals, fn: (signal: NodeJS.Signals) => void) => {
        listeners.set(signal, fn);
      }),
      exit: jest.fn(),
    };
  }

  it('handles SIGINT and SIGTERM', () => {
    const target = fakeTarget();
    registerGracefulShutdown({ close: jest.fn() } as any, new Logger('t'), target as any);

    expect(SHUTDOWN_SIGNALS).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));
    expect([...target.listeners.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it.each(['SIGINT', 'SIGTERM'] as NodeJS.Signals[])(
    '%s waits for app.close() before exiting, and a second signal does not close twice',
    async (signal) => {
      let finishClose!: () => void;
      const app = { close: jest.fn(() => new Promise<void>((r) => (finishClose = r))) };
      const target = fakeTarget();
      registerGracefulShutdown(app, new Logger('t'), target as any);

      target.listeners.get(signal)!(signal);
      target.listeners.get('SIGINT')!('SIGINT');
      await Promise.resolve();

      expect(app.close).toHaveBeenCalledTimes(1);
      expect(target.exit).not.toHaveBeenCalled(); // jobs ativos ainda terminando

      finishClose();
      await new Promise((r) => setImmediate(r));
      expect(target.exit).toHaveBeenCalledWith(0);
    },
  );

  it('the real process gets SIGINT and SIGTERM listeners', () => {
    const before = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
    };
    registerGracefulShutdown({ close: jest.fn(async () => undefined) }, new Logger('t'));
    try {
      expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1);
      expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1);
    } finally {
      // Nao deixa o handler de teste no processo do jest.
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        const listeners = process.listeners(signal);
        process.removeListener(signal, listeners[listeners.length - 1] as any);
      }
    }
  });
});

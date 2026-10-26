import { Logger } from '@nestjs/common';

/** Sinais que o PM2 (SIGINT por padrao) e o Docker/systemd (SIGTERM) mandam. */
export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

interface Closable {
  close(): Promise<void>;
}

interface SignalTarget {
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code?: number): never | void;
}

/**
 * BC-10: encerra a aplicacao com `app.close()` em SIGINT e SIGTERM. No worker,
 * o close fecha os Workers do BullMQ esperando os jobs ativos terminarem (sem
 * isso o processo morre com ate 100 jobs em `active`, que viram stalled e sao
 * reenviados). Um segundo sinal durante o close nao reinicia o encerramento.
 */
export function registerGracefulShutdown(
  app: Closable,
  logger: Logger,
  target: SignalTarget = process,
): void {
  let closing: Promise<void> | null = null;

  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) {
      logger.warn(`${signal} recebido com encerramento em andamento — aguardando`);
      return;
    }
    logger.log(`${signal} recebido, encerrando (aguardando jobs ativos)...`);
    closing = app
      .close()
      .then(() => {
        logger.log('Encerrado sem jobs ativos.');
        target.exit(0);
      })
      .catch((error) => {
        logger.error(
          `Erro no encerramento: ${error instanceof Error ? error.message : String(error)}`,
        );
        target.exit(1);
      });
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    target.on(signal, shutdown);
  }
}

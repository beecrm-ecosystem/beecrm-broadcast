import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Client Redis compartilhado (ioredis), separado das conexões do BullMQ.
 * Usado para estado que precisa sobreviver a restart e ser compartilhado entre
 * pods — ex.: o high-water-mark de contadores por broadcast (summaryHistory).
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () =>
    new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
};

import type { RedisOptions } from 'ioredis';

export interface RedisPersistenceModuleOptions {
  url?: string;
  redis?: RedisOptions;
  keyPrefix?: string;
  ttlSeconds?: number;
}
import {
  Inject,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import {
  DEFAULT_REDIS_JOB_KEY_PREFIX,
  DEFAULT_REDIS_JOB_TTL_SECONDS,
  JOB_REPOSITORY_TOKEN,
  REDIS_CLIENT_TOKEN,
  REDIS_PERSISTENCE_OPTIONS_TOKEN,
} from './persistence.constants.js';
import type { RedisPersistenceModuleOptions } from './persistence.types.js';
import { RedisJobRepository } from './redis-job-repository.js';

@Module({})
export class PersistenceModule {
  static register(
    options: RedisPersistenceModuleOptions = {},
  ): DynamicModule {
    const resolvedOptions: RedisPersistenceModuleOptions = {
      keyPrefix: DEFAULT_REDIS_JOB_KEY_PREFIX,
      ttlSeconds: DEFAULT_REDIS_JOB_TTL_SECONDS,
      ...options,
    };

    return {
      module: PersistenceModule,
      providers: [
        {
          provide: REDIS_PERSISTENCE_OPTIONS_TOKEN,
          useValue: resolvedOptions,
        },
        {
          provide: REDIS_CLIENT_TOKEN,
          useFactory: (redisOptions: RedisPersistenceModuleOptions) => {
            if (redisOptions.url) {
              return new Redis(redisOptions.url, redisOptions.redis ?? {});
            }

            return new Redis(redisOptions.redis ?? {});
          },
          inject: [REDIS_PERSISTENCE_OPTIONS_TOKEN],
        },
        RedisJobRepository,
        {
          provide: JOB_REPOSITORY_TOKEN,
          useExisting: RedisJobRepository,
        },
        RedisClientLifecycle,
      ],
      exports: [
        REDIS_CLIENT_TOKEN,
        JOB_REPOSITORY_TOKEN,
        RedisJobRepository,
      ],
    };
  }
}

class RedisClientLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'end') {
      return;
    }

    await this.redis.quit();
  }
}
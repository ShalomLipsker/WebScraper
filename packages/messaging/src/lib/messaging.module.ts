import {
  Module,
  type DynamicModule,
  type FactoryProvider,
} from '@nestjs/common';

import { BullMqMessageQueue } from './bullmq-message-queue.js';
import {
  BULLMQ_MESSAGING_OPTIONS_TOKEN,
  DEFAULT_JOB_ATTEMPTS,
  DEFAULT_JOB_BACKOFF_DELAY_MS,
  DEFAULT_JOB_BACKOFF_TYPE,
  DEFAULT_JOB_HISTORY_AGE_SECONDS,
  DEFAULT_JOB_HISTORY_COUNT,
  DEFAULT_JOB_NAME,
  DEFAULT_QUEUE_NAME,
  DEFAULT_WORKER_CONCURRENCY,
  MESSAGE_QUEUE_TOKEN,
} from './messaging.constants.js';
import type {
  BullMqMessagingModuleOptions,
  MessagingModuleAsyncOptions,
  ResolvedBullMqMessagingModuleOptions,
} from './messaging.types.js';

@Module({})
export class MessagingModule {
  static register(
    options: BullMqMessagingModuleOptions = {},
  ): DynamicModule {
    const resolvedOptions = resolveBullMqMessagingOptions(options);

    return {
      module: MessagingModule,
      providers: [
        {
          provide: BULLMQ_MESSAGING_OPTIONS_TOKEN,
          useValue: resolvedOptions,
        },
        BullMqMessageQueue,
        {
          provide: MESSAGE_QUEUE_TOKEN,
          useExisting: BullMqMessageQueue,
        },
      ],
      exports: [MESSAGE_QUEUE_TOKEN, BullMqMessageQueue],
    };
  }

  static registerAsync(options: MessagingModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider<ResolvedBullMqMessagingModuleOptions> = {
      provide: BULLMQ_MESSAGING_OPTIONS_TOKEN,
      useFactory: async (...args: unknown[]) => resolveBullMqMessagingOptions(
        await options.useFactory(...args),
      ),
      inject: options.inject ?? [],
    };

    return {
      module: MessagingModule,
      imports: options.imports,
      providers: [
        optionsProvider,
        BullMqMessageQueue,
        {
          provide: MESSAGE_QUEUE_TOKEN,
          useExisting: BullMqMessageQueue,
        },
      ],
      exports: [MESSAGE_QUEUE_TOKEN, BullMqMessageQueue],
    };
  }
}

export function resolveRedisConnection(redisUrl?: string) {
  if (!redisUrl) {
    return {};
  }

  const parsedUrl = new URL(redisUrl);
  const db = parsedUrl.pathname.length > 1 ? Number(parsedUrl.pathname.slice(1)) : undefined;

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
    username: parsedUrl.username || undefined,
    password: parsedUrl.password || undefined,
    db: Number.isNaN(db) ? undefined : db,
    tls: parsedUrl.protocol === 'rediss:' ? {} : undefined,
  };
}

export function resolveBullMqMessagingOptions(
  options: BullMqMessagingModuleOptions,
): ResolvedBullMqMessagingModuleOptions {
  return {
    queueName: options.queueName ?? DEFAULT_QUEUE_NAME,
    defaultJobName: options.defaultJobName ?? DEFAULT_JOB_NAME,
    connection: options.connection ?? {},
    prefix: options.prefix,
    defaultPublishOptions: resolvePublishOptions(options.defaultPublishOptions),
    worker: resolveWorkerOptions(options.worker),
  };
}

type PublishOptionsInput = NonNullable<
  BullMqMessagingModuleOptions['defaultPublishOptions']
>;

function resolvePublishOptions(
  options: BullMqMessagingModuleOptions['defaultPublishOptions'],
): ResolvedBullMqMessagingModuleOptions['defaultPublishOptions'] {
  const defaultBackoff: ResolvedBullMqMessagingModuleOptions['defaultPublishOptions']['backoff'] = {
    type: DEFAULT_JOB_BACKOFF_TYPE,
    delayMs: DEFAULT_JOB_BACKOFF_DELAY_MS,
  };

  return {
    attempts: options?.attempts ?? DEFAULT_JOB_ATTEMPTS,
    backoff: options?.backoff ?? defaultBackoff,
    removeOnComplete: resolvePublishRetention(options?.removeOnComplete),
    removeOnFail: resolvePublishRetention(options?.removeOnFail),
  };
}

function resolvePublishRetention(
  retention: PublishOptionsInput['removeOnComplete'] | undefined,
): ResolvedBullMqMessagingModuleOptions['defaultPublishOptions']['removeOnComplete'] {
  return {
    ageSeconds: retention?.ageSeconds ?? DEFAULT_JOB_HISTORY_AGE_SECONDS,
    maxCount: retention?.maxCount ?? DEFAULT_JOB_HISTORY_COUNT,
  };
}

function resolveWorkerOptions(
  options: BullMqMessagingModuleOptions['worker'],
): ResolvedBullMqMessagingModuleOptions['worker'] {
  const resolvedOptions: ResolvedBullMqMessagingModuleOptions['worker'] = {
    autorun: options?.autorun ?? true,
    concurrency: options?.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    maxStalledCount: options?.maxStalledCount ?? 1,
    removeOnComplete: resolveWorkerRetention(options?.removeOnComplete),
    removeOnFail: resolveWorkerRetention(options?.removeOnFail),
  };

  assignWorkerOptionIfDefined(resolvedOptions, options, 'drainDelay');
  assignWorkerOptionIfDefined(resolvedOptions, options, 'lockDuration');
  assignWorkerOptionIfDefined(resolvedOptions, options, 'skipLockRenewal');
  assignWorkerOptionIfDefined(resolvedOptions, options, 'skipStalledCheck');
  assignWorkerOptionIfDefined(resolvedOptions, options, 'stalledInterval');

  return resolvedOptions;
}

function assignWorkerOptionIfDefined<
  TKey extends keyof ResolvedBullMqMessagingModuleOptions['worker'],
>(
  target: ResolvedBullMqMessagingModuleOptions['worker'],
  source: BullMqMessagingModuleOptions['worker'],
  key: TKey,
): void {
  const value = source?.[key];

  if (value !== undefined) {
    target[key] = value;
  }
}

function resolveWorkerRetention(
  retention: ResolvedBullMqMessagingModuleOptions['worker']['removeOnComplete'],
): NonNullable<ResolvedBullMqMessagingModuleOptions['worker']['removeOnComplete']> {
  return retention ?? {
    age: DEFAULT_JOB_HISTORY_AGE_SECONDS,
    count: DEFAULT_JOB_HISTORY_COUNT,
  };
}
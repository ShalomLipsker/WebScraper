import { Module, type DynamicModule } from '@nestjs/common';

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
  return {
    autorun: options?.autorun ?? true,
    concurrency: options?.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    drainDelay: options?.drainDelay,
    lockDuration: options?.lockDuration,
    maxStalledCount: options?.maxStalledCount,
    removeOnComplete: resolveWorkerRetention(options?.removeOnComplete),
    removeOnFail: resolveWorkerRetention(options?.removeOnFail),
    skipLockRenewal: options?.skipLockRenewal,
    skipStalledCheck: options?.skipStalledCheck,
    stalledInterval: options?.stalledInterval,
  };
}

function resolveWorkerRetention(
  retention: ResolvedBullMqMessagingModuleOptions['worker']['removeOnComplete'],
): NonNullable<ResolvedBullMqMessagingModuleOptions['worker']['removeOnComplete']> {
  return retention ?? {
    age: DEFAULT_JOB_HISTORY_AGE_SECONDS,
    count: DEFAULT_JOB_HISTORY_COUNT,
  };
}
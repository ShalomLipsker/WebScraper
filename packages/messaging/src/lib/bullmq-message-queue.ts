import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  Queue,
  Worker,
  type JobsOptions,
  type Job,
  type KeepJobs,
} from 'bullmq';

import {
  BULLMQ_MESSAGING_OPTIONS_TOKEN,
  DEFAULT_JOB_ATTEMPTS,
  DEFAULT_JOB_HISTORY_COUNT,
} from './messaging.constants.js';
import type {
  IMessageQueue,
  IMessageWorker,
  MessageHandler,
  MessageWorkerRegistrationOptions,
  PublishedQueueMessage,
  QueueHistoryRetention,
  QueueMessage,
  QueuePublishOptions,
  ResolvedBullMqMessagingModuleOptions,
} from './messaging.types.js';

@Injectable()
export class BullMqMessageQueue implements IMessageQueue, OnModuleDestroy {
  private readonly queue: Queue;
  private readonly workers = new Set<Worker>();

  constructor(
    @Inject(BULLMQ_MESSAGING_OPTIONS_TOKEN)
    private readonly options: ResolvedBullMqMessagingModuleOptions,
  ) {
    this.queue = new Queue(this.options.queueName, {
      connection: this.options.connection,
      prefix: this.options.prefix,
      defaultJobOptions: toBullMqJobOptions(this.options.defaultPublishOptions),
    });
  }

  async publish<TPayload>(
    message: QueueMessage<TPayload>,
    options: QueuePublishOptions = {},
  ): Promise<PublishedQueueMessage<TPayload>> {
    const resolvedName = message.name ?? this.options.defaultJobName;

    await this.queue.add(resolvedName, message.data, {
      ...toBullMqJobOptions(this.options.defaultPublishOptions, options),
      jobId: message.id,
    });

    return {
      ...message,
      name: resolvedName,
      queueName: this.options.queueName,
      attempts:
        options.attempts ?? this.options.defaultPublishOptions.attempts,
    };
  }

  async registerHandler<TPayload, TResult = void>(
    handler: MessageHandler<TPayload, TResult>,
    options: MessageWorkerRegistrationOptions = {},
  ): Promise<IMessageWorker> {
    const worker = new Worker<TPayload, TResult>(
      this.options.queueName,
      async (job) => handler(mapJob(job)),
      {
        connection: this.options.connection,
        prefix: this.options.prefix,
        ...this.options.worker,
        concurrency:
          options.concurrency ?? this.options.worker.concurrency,
      },
    );

    this.workers.add(worker);
    worker.once('closed', () => {
      this.workers.delete(worker);
    });

    await worker.waitUntilReady();

    return {
      close: async () => {
        this.workers.delete(worker);
        await worker.close();
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      Array.from(this.workers, async (worker) => {
        this.workers.delete(worker);
        await worker.close();
      }),
    );

    await this.queue.close();
  }
}

function mapJob<TPayload, TResult>(job: Job<TPayload, TResult>) {
  return {
    id: job.id ?? '',
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  };
}

function toBullMqJobOptions(
  defaults: QueuePublishOptions,
  overrides: QueuePublishOptions = {},
): JobsOptions {
  const resolvedBackoff = overrides.backoff ?? defaults.backoff;

  const backoff = resolvedBackoff
    ? {
      type: resolvedBackoff.type,
      delay: resolvedBackoff.delayMs,
    }
    : undefined;

  return {
    attempts: overrides.attempts ?? defaults.attempts ?? DEFAULT_JOB_ATTEMPTS,
    backoff,
    removeOnComplete: toKeepJobs(
      defaults.removeOnComplete,
      overrides.removeOnComplete,
    ),
    removeOnFail: toKeepJobs(defaults.removeOnFail, overrides.removeOnFail),
  };
}

function toKeepJobs(
  defaults: QueueHistoryRetention | undefined,
  overrides: QueueHistoryRetention | undefined,
): KeepJobs | undefined {
  if (!defaults && !overrides) {
    return undefined;
  }

  const ageSeconds = overrides?.ageSeconds ?? defaults?.ageSeconds;
  const maxCount = overrides?.maxCount ?? defaults?.maxCount;

  if (ageSeconds !== undefined) {
    return {
      age: ageSeconds,
      count: maxCount,
    };
  }

  return {
    count: maxCount ?? DEFAULT_JOB_HISTORY_COUNT,
  };
}

import {
  Module,
  type DynamicModule,
  type FactoryProvider,
} from '@nestjs/common';

import { RabbitMqMessageQueue } from './rabbitmq-message-queue.js';
import {
  DEFAULT_EXCHANGE_NAME,
  DEFAULT_EXCHANGE_TYPE,
  DEFAULT_JOB_ATTEMPTS,
  DEFAULT_JOB_BACKOFF_DELAY_MS,
  DEFAULT_JOB_BACKOFF_TYPE,
  DEFAULT_JOB_NAME,
  DEFAULT_QUEUE_NAME,
  DEFAULT_WORKER_CONCURRENCY,
  MESSAGE_QUEUE_TOKEN,
  RABBITMQ_MESSAGING_OPTIONS_TOKEN,
} from './messaging.constants.js';
import type {
  MessagingModuleAsyncOptions,
  RabbitMqMessagingModuleOptions,
  ResolvedRabbitMqMessagingModuleOptions,
} from './messaging.types.js';

@Module({})
export class MessagingModule {
  static register(
    options: RabbitMqMessagingModuleOptions = {},
  ): DynamicModule {
    const resolvedOptions = resolveRabbitMqMessagingOptions(options);

    return {
      module: MessagingModule,
      providers: [
        {
          provide: RABBITMQ_MESSAGING_OPTIONS_TOKEN,
          useValue: resolvedOptions,
        },
        RabbitMqMessageQueue,
        {
          provide: MESSAGE_QUEUE_TOKEN,
          useExisting: RabbitMqMessageQueue,
        },
      ],
      exports: [MESSAGE_QUEUE_TOKEN, RabbitMqMessageQueue],
    };
  }

  static registerAsync(options: MessagingModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider<ResolvedRabbitMqMessagingModuleOptions> = {
      provide: RABBITMQ_MESSAGING_OPTIONS_TOKEN,
      useFactory: async (...args: unknown[]) => resolveRabbitMqMessagingOptions(
        await options.useFactory(...args),
      ),
      inject: options.inject ?? [],
    };

    return {
      module: MessagingModule,
      imports: options.imports,
      providers: [
        optionsProvider,
        RabbitMqMessageQueue,
        {
          provide: MESSAGE_QUEUE_TOKEN,
          useExisting: RabbitMqMessageQueue,
        },
      ],
      exports: [MESSAGE_QUEUE_TOKEN, RabbitMqMessageQueue],
    };
  }
}

export function resolveRabbitMqMessagingOptions(
  options: RabbitMqMessagingModuleOptions,
): ResolvedRabbitMqMessagingModuleOptions {
  return {
    url: options.url ?? 'amqp://127.0.0.1:5672',
    queueName: options.queueName ?? DEFAULT_QUEUE_NAME,
    defaultJobName: options.defaultJobName ?? DEFAULT_JOB_NAME,
    exchange: options.exchange ?? DEFAULT_EXCHANGE_NAME,
    exchangeType: options.exchangeType ?? DEFAULT_EXCHANGE_TYPE,
    durable: options.durable ?? true,
    prefetchCount: options.prefetchCount ?? DEFAULT_WORKER_CONCURRENCY,
    retryQueueName: options.retryQueueName ?? `${options.queueName ?? DEFAULT_QUEUE_NAME}.retry`,
    deadLetterQueueName:
      options.deadLetterQueueName ?? `${options.queueName ?? DEFAULT_QUEUE_NAME}.dead-letter`,
    queueDeduplication: {
      enabled: options.queueDeduplication?.enabled ?? false,
    },
    defaultPublishOptions: resolvePublishOptions(options.defaultPublishOptions),
  };
}

function resolvePublishOptions(
  options: RabbitMqMessagingModuleOptions['defaultPublishOptions'],
): ResolvedRabbitMqMessagingModuleOptions['defaultPublishOptions'] {
  const defaultBackoff: ResolvedRabbitMqMessagingModuleOptions['defaultPublishOptions']['backoff'] = {
    type: DEFAULT_JOB_BACKOFF_TYPE,
    delayMs: DEFAULT_JOB_BACKOFF_DELAY_MS,
  };

  return {
    attempts: options?.attempts ?? DEFAULT_JOB_ATTEMPTS,
    backoff: options?.backoff ?? defaultBackoff,
    headers: options?.headers ?? {},
  };
}
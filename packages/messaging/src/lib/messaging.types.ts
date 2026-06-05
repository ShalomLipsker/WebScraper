import type {
  DynamicModule,
  InjectionToken,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';

export interface QueueBackoffPolicy {
  type: 'fixed' | 'exponential';
  delayMs: number;
}

export type QueueMessageHeaderValue = string | number | boolean;

export interface QueuePublishOptions {
  attempts?: number;
  backoff?: QueueBackoffPolicy;
  correlationId?: string;
  headers?: Record<string, QueueMessageHeaderValue>;
}

export interface RabbitMqQueueDeduplicationOptions {
  enabled?: boolean;
}

export interface QueueMessage<TPayload> {
  id: string;
  data: TPayload;
  name?: string;
}

export type QueueJobState =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'missing';

export interface PublishedQueueMessage<TPayload>
  extends QueueMessage<TPayload> {
  queueName: string;
  attempts: number;
  correlationId?: string;
}

export interface QueueHandlerMessage<TPayload> {
  id: string;
  name: string;
  data: TPayload;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: number;
  correlationId?: string;
  headers: Record<string, QueueMessageHeaderValue>;
}

export type MessageHandler<TPayload, TResult = void> = (
  message: QueueHandlerMessage<TPayload>,
) => Promise<TResult>;

export interface MessageWorkerRegistrationOptions {
  concurrency?: number;
}

export interface IMessageWorker {
  close(): Promise<void>;
}

export interface IMessageQueue {
  publish<TPayload>(
    message: QueueMessage<TPayload>,
    options?: QueuePublishOptions,
  ): Promise<PublishedQueueMessage<TPayload>>;

  registerHandler<TPayload, TResult = void>(
    handler: MessageHandler<TPayload, TResult>,
    options?: MessageWorkerRegistrationOptions,
  ): Promise<IMessageWorker>;
}

export interface RabbitMqMessagingModuleOptions {
  url?: string;
  queueName?: string;
  defaultJobName?: string;
  exchange?: string;
  exchangeType?: 'direct' | 'fanout' | 'topic';
  durable?: boolean;
  prefetchCount?: number;
  retryQueueName?: string;
  deadLetterQueueName?: string;
  queueDeduplication?: RabbitMqQueueDeduplicationOptions;
  defaultPublishOptions?: QueuePublishOptions;
}

export type ResolvedRabbitMqMessagingModuleOptions =
  Required<Omit<RabbitMqMessagingModuleOptions, 'defaultPublishOptions' | 'queueDeduplication'>> & {
    queueDeduplication: Required<RabbitMqQueueDeduplicationOptions>;
    defaultPublishOptions: Required<Omit<QueuePublishOptions, 'correlationId'>> & {
      correlationId?: string;
    };
  }

export interface MessagingModuleAsyncOptions {
  imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule>>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: unknown[]) =>
    | RabbitMqMessagingModuleOptions
    | Promise<RabbitMqMessagingModuleOptions>;
}

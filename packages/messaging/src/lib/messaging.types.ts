import type { ConnectionOptions, WorkerOptions } from 'bullmq';

export interface QueueHistoryRetention {
  ageSeconds?: number;
  maxCount?: number;
}

export interface QueueBackoffPolicy {
  type: 'fixed' | 'exponential';
  delayMs: number;
}

export interface QueuePublishOptions {
  attempts?: number;
  backoff?: QueueBackoffPolicy;
  removeOnComplete?: QueueHistoryRetention;
  removeOnFail?: QueueHistoryRetention;
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
}

export interface QueueHandlerMessage<TPayload> {
  id: string;
  name: string;
  data: TPayload;
  attemptsMade: number;
  timestamp: number;
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

  getJobState(jobId: string): Promise<QueueJobState>;

  registerHandler<TPayload, TResult = void>(
    handler: MessageHandler<TPayload, TResult>,
    options?: MessageWorkerRegistrationOptions,
  ): Promise<IMessageWorker>;
}

export type MessagingWorkerOptions = Pick<
  WorkerOptions,
  | 'autorun'
  | 'concurrency'
  | 'drainDelay'
  | 'lockDuration'
  | 'maxStalledCount'
  | 'removeOnComplete'
  | 'removeOnFail'
  | 'skipLockRenewal'
  | 'skipStalledCheck'
  | 'stalledInterval'
>;

export interface BullMqMessagingModuleOptions {
  queueName?: string;
  defaultJobName?: string;
  connection?: ConnectionOptions;
  prefix?: string;
  defaultPublishOptions?: QueuePublishOptions;
  worker?: MessagingWorkerOptions;
}

export type ResolvedBullMqMessagingModuleOptions =
  Required<Omit<BullMqMessagingModuleOptions, 'prefix' | 'defaultPublishOptions'>> & {
    prefix?: string;
    defaultPublishOptions: Required<QueuePublishOptions>;
  }

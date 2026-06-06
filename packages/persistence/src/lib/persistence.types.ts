import type { CreateJobInput, JobMetadata } from '@org/domain';

export interface PostgresPersistenceModuleOptions {
  url?: string;
  schema?: string;
  synchronize?: boolean;
  logging?: boolean;
  jobRetentionSeconds?: number;
  outboxClaimBatchSize?: number;
  outboxRetryDelayMs?: number;
  outboxClaimTtlMs?: number;
}

export interface PersistedOutboxMessage<TPayload = unknown> {
  id: string;
  messageId: string;
  queueName: string;
  messageName?: string;
  payload: TPayload;
  attemptCount: number;
  nextAttemptAt: Date;
  publishedAt: Date | null;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueOutboxMessageInput<TPayload = unknown> {
  aggregateId: string;
  queueName: string;
  message: OutboxQueueMessage<TPayload>;
}

export interface ClaimedOutboxMessage<TPayload = unknown> {
  outboxId: string;
  aggregateId: string;
  message: OutboxQueueMessage<TPayload>;
  queueName: string;
  attemptCount: number;
}

export interface ClaimOutboxMessagesOptions {
  batchSize?: number;
  maxAttempts?: number;
}

export interface OutboxQueueMessage<TPayload = unknown> {
  id: string;
  data: TPayload;
  name?: string;
}

export interface IOutboxMessageStore {
  enqueue<TPayload>(input: EnqueueOutboxMessageInput<TPayload>): Promise<PersistedOutboxMessage<TPayload>>;
  claimBatch(options?: ClaimOutboxMessagesOptions): Promise<Array<ClaimedOutboxMessage>>;
  deletePublishedBefore(cutoff: Date): Promise<number>;
  markPublished(outboxId: string): Promise<void>;
  markJobEnqueuedAndPublished(jobId: string, outboxId: string): Promise<void>;
  markFailed(outboxId: string, errorMessage: string): Promise<void>;
}

export interface CreateJobSubmissionInput<TPayload = unknown> {
  job: CreateJobInput;
  queueName: string;
  message: OutboxQueueMessage<TPayload>;
}

export interface IJobSubmissionStore {
  createJobSubmissionIfNotExists<TPayload>(
    input: CreateJobSubmissionInput<TPayload>,
  ): Promise<{ job: JobMetadata; alreadyExisted: boolean }>;
}
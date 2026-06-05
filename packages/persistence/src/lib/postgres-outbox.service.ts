import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  DEFAULT_JOB_RETENTION_SECONDS,
  DEFAULT_OUTBOX_CLAIM_BATCH_SIZE,
  DEFAULT_OUTBOX_CLAIM_TTL_MS,
  DEFAULT_OUTBOX_RETRY_DELAY_MS,
  POSTGRES_PERSISTENCE_OPTIONS_TOKEN,
} from './persistence.constants.js';
import { JobEntity, OutboxMessageEntity } from './persistence.entities.js';
import type {
  ClaimedOutboxMessage,
  EnqueueOutboxMessageInput,
  IOutboxMessageStore,
  PersistedOutboxMessage,
  PostgresPersistenceModuleOptions,
} from './persistence.types.js';

@Injectable()
export class PostgresOutboxService implements IOutboxMessageStore {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OutboxMessageEntity)
    private readonly outboxRepository: Repository<OutboxMessageEntity>,
    @Inject(POSTGRES_PERSISTENCE_OPTIONS_TOKEN)
    private readonly options: PostgresPersistenceModuleOptions,
  ) {}

  async enqueue<TPayload>(
    input: EnqueueOutboxMessageInput<TPayload>,
  ): Promise<PersistedOutboxMessage<TPayload>> {
    const entity = this.outboxRepository.create({
      id: randomUUID(),
      aggregateId: input.aggregateId,
      messageId: input.message.id,
      queueName: input.queueName,
      messageName: input.message.name ?? null,
      payload: input.message.data,
      nextAttemptAt: new Date(),
      publishedAt: null,
      attemptCount: 0,
      lastError: null,
    });

    const savedMessage = await this.outboxRepository.save(entity);

    return toPersistedOutboxMessage(savedMessage) as PersistedOutboxMessage<TPayload>;
  }

  async claimBatch(batchSize?: number): Promise<Array<ClaimedOutboxMessage>> {
    const resolvedBatchSize =
      batchSize
      ?? this.options.outboxClaimBatchSize
      ?? DEFAULT_OUTBOX_CLAIM_BATCH_SIZE;

    const claimTtlMs =
      this.options.outboxClaimTtlMs
      ?? DEFAULT_OUTBOX_CLAIM_TTL_MS;
      
    const claimedMessages = await this.outboxRepository.query(
      `
        WITH candidate AS (
          SELECT id
          FROM outbox_messages
          WHERE published_at IS NULL
            AND next_attempt_at <= NOW()
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE outbox_messages AS outbox
        SET next_attempt_at = $2,
            updated_at = NOW()
        FROM candidate
        WHERE outbox.id = candidate.id
        RETURNING outbox.id,
                  outbox.aggregate_id,
                  outbox.message_id,
                  outbox.queue_name,
                  outbox.message_name,
                  outbox.payload,
                  outbox.attempt_count
      `,
      [resolvedBatchSize, new Date(Date.now() + claimTtlMs)],
    );

    return claimedMessages.map((message: Record<string, unknown>) => ({
      outboxId: String(message.id),
      aggregateId: String(message.aggregate_id),
      queueName: String(message.queue_name),
      attemptCount: Number(message.attempt_count),
      message: {
        id: String(message.message_id),
        name:
          message.message_name === null
            ? undefined
            : String(message.message_name),
        data: message.payload,
      },
    }));
  }

  async markPublished(outboxId: string): Promise<void> {
    await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxMessageEntity)
      .set({
        publishedAt: new Date(),
        nextAttemptAt: new Date(),
        lastError: null,
      })
      .where('id = :id', { id: outboxId })
      .execute();
  }

  async markJobEnqueuedAndPublished(
    jobId: string,
    outboxId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (entityManager) => {
      const jobsRepository = entityManager.getRepository(JobEntity);
      const outboxRepository = entityManager.getRepository(OutboxMessageEntity);

      await jobsRepository
        .createQueryBuilder()
        .update(JobEntity)
        .set({
          status: 'ENQUEUED',
          expiresAt: createExpirationDate(this.options),
        })
        .where('id = :id', { id: jobId })
        .andWhere('status IN (:...allowedStatuses)', {
          allowedStatuses: ['SUBMITTED', 'ENQUEUED'],
        })
        .execute();

      await outboxRepository
        .createQueryBuilder()
        .update(OutboxMessageEntity)
        .set({
          publishedAt: new Date(),
          nextAttemptAt: new Date(),
          lastError: null,
        })
        .where('id = :id', { id: outboxId })
        .execute();
    });
  }

  async markFailed(outboxId: string, errorMessage: string): Promise<void> {
    const retryDelayMs =
      this.options.outboxRetryDelayMs ?? DEFAULT_OUTBOX_RETRY_DELAY_MS;

    await this.outboxRepository.query(
      `
        UPDATE outbox_messages
        SET attempt_count = attempt_count + 1,
            last_error = $2,
            next_attempt_at = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [outboxId, errorMessage, new Date(Date.now() + retryDelayMs)],
    );
  }
}

function toPersistedOutboxMessage(
  message: OutboxMessageEntity,
): PersistedOutboxMessage {
  return {
    id: message.id,
    messageId: message.messageId,
    queueName: message.queueName,
    messageName: message.messageName ?? undefined,
    payload: message.payload,
    attemptCount: message.attemptCount,
    nextAttemptAt: new Date(message.nextAttemptAt),
    publishedAt: message.publishedAt ? new Date(message.publishedAt) : null,
    lastError: message.lastError ?? undefined,
    createdAt: new Date(message.createdAt),
    updatedAt: new Date(message.updatedAt),
  };
}

function createExpirationDate(
  options: PostgresPersistenceModuleOptions,
): Date {
  return new Date(
    Date.now()
      + (options.jobRetentionSeconds ?? DEFAULT_JOB_RETENTION_SECONDS) * 1000,
  );
}
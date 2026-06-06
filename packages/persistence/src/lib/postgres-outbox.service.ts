import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { PinoLoggerService } from '@org/logger';
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
  ClaimOutboxMessagesOptions,
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
    @Optional()
    private readonly logger?: PinoLoggerService,
  ) { }

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

    this.logger?.log({
      event: 'enqueued outbox message',
      outboxId: savedMessage.id,
      jobId: input.aggregateId,
      messageId: input.message.id,
      messageName: input.message.name,
      queueName: input.queueName,
      correlationId: getCorrelationIdFromPayload(input.message.data),
    });

    return toPersistedOutboxMessage(savedMessage) as PersistedOutboxMessage<TPayload>;
  }

  async claimBatch(
    options: ClaimOutboxMessagesOptions = {},
  ): Promise<Array<ClaimedOutboxMessage>> {
    const resolvedBatchSize =
      options.batchSize
      ?? this.options.outboxClaimBatchSize
      ?? DEFAULT_OUTBOX_CLAIM_BATCH_SIZE;

    const claimTtlMs =
      this.options.outboxClaimTtlMs
      ?? DEFAULT_OUTBOX_CLAIM_TTL_MS;

    const queryParameters: Array<Date | number> = [
      resolvedBatchSize,
      new Date(Date.now() + claimTtlMs),
    ];

    const maxAttemptsFilter = options.maxAttempts === undefined
      ? ''
      : '            AND attempt_count < $3';

    if (options.maxAttempts !== undefined) {
      queryParameters.push(options.maxAttempts);
    }

    const rawClaimedMessages = await this.outboxRepository.query(
      `
        WITH candidate AS (
          SELECT id
          FROM outbox_messages
          WHERE published_at IS NULL
            AND next_attempt_at <= NOW()
${maxAttemptsFilter}
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
      queryParameters,
    );

    const claimedMessages = Array.isArray(rawClaimedMessages[0])
      ? rawClaimedMessages[0]
      : rawClaimedMessages;

    if (claimedMessages.length > 0) {
      this.logger?.log({
        event: 'claimed outbox message batch',
        batchSize: claimedMessages.length,
      });
    }

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

  async deletePublishedBefore(cutoff: Date): Promise<number> {
    const result = await this.outboxRepository
      .createQueryBuilder()
      .delete()
      .from(OutboxMessageEntity)
      .where('published_at IS NOT NULL')
      .andWhere('published_at < :cutoff', { cutoff })
      .execute();

    const deletedCount = result.affected ?? 0;

    if (deletedCount > 0) {
      this.logger?.log({
        event: 'deleted expired outbox messages',
        deletedCount,
        cutoff: cutoff.toISOString(),
      });
    }

    return deletedCount;
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

    this.logger?.log({
      event: 'marked outbox message published',
      outboxId,
      outcome: 'published',
    });
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

    this.logger?.log({
      event: 'marked job enqueued and outbox message published',
      jobId,
      outboxId,
      outcome: 'published',
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

    this.logger?.warn({
      event: 'marked outbox message failed',
      outboxId,
      retryDelayMs,
      errorMessage,
      outcome: 'failed',
    });
  }
}

function getCorrelationIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const correlationId = (payload as { correlationId?: unknown }).correlationId;

  return typeof correlationId === 'string' ? correlationId : undefined;
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
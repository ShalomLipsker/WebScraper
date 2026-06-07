import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobEntity, OutboxMessageEntity } from '../src/lib/persistence.entities.js';
import { PostgresOutboxService } from '../src/lib/postgres-outbox.service.js';
import type { PostgresPersistenceModuleOptions } from '../src/lib/persistence.types.js';
import { createPostgresTestContext, type PostgresTestContext } from './postgres-test.utils.js';

describe('PostgresOutboxService integration', { concurrent: false }, () => {
  let context: PostgresTestContext;
  let service: PostgresOutboxService;
  let options: PostgresPersistenceModuleOptions;

  beforeAll(async () => {
    context = await createPostgresTestContext({
      label: 'outbox_service',
      entities: [JobEntity, OutboxMessageEntity],
    });
    options = {
      jobRetentionSeconds: 3_600,
      outboxRetryDelayMs: 4_000,
      outboxClaimTtlMs: 20_000,
      outboxClaimBatchSize: 2,
    };
    service = new PostgresOutboxService(
      context.dataSource,
      context.dataSource.getRepository(OutboxMessageEntity),
      options,
    );
  });

  afterEach(async () => {
    await context.reset();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('enqueue persists an unpublished outbox message with zero attempts', async () => {
    const persisted = await service.enqueue({
      aggregateId: 'job-enqueue',
      queueName: 'scrape-job-queue',
      message: {
        id: 'message-enqueue',
        name: 'scrape.submit',
        data: { url: 'https://example.com/enqueue', correlationId: 'corr-enqueue' },
      },
    });

    expect(persisted).toMatchObject({
      messageId: 'message-enqueue',
      queueName: 'scrape-job-queue',
      messageName: 'scrape.submit',
      attemptCount: 0,
      publishedAt: null,
      lastError: undefined,
      payload: { url: 'https://example.com/enqueue', correlationId: 'corr-enqueue' },
    });
  });

  it('claimBatch returns only due unpublished messages and advances nextAttemptAt', async () => {
    const outboxRepository = context.dataSource.getRepository(OutboxMessageEntity);
    const dueBeforeClaim = new Date(Date.now() - 1_000);

    await outboxRepository.save([
      outboxRepository.create({
        id: 'outbox-due',
        aggregateId: 'job-due',
        messageId: 'message-due',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/due' },
        attemptCount: 0,
        publishedAt: null,
        nextAttemptAt: dueBeforeClaim,
        lastError: null,
      }),
      outboxRepository.create({
        id: 'outbox-future',
        aggregateId: 'job-future',
        messageId: 'message-future',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/future' },
        attemptCount: 0,
        publishedAt: null,
        nextAttemptAt: new Date(Date.now() + 60_000),
        lastError: null,
      }),
      outboxRepository.create({
        id: 'outbox-published',
        aggregateId: 'job-published',
        messageId: 'message-published',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/published' },
        attemptCount: 0,
        publishedAt: new Date(),
        nextAttemptAt: dueBeforeClaim,
        lastError: null,
      }),
    ]);

    const claimed = await service.claimBatch();
    const persistedDue = await outboxRepository.findOneByOrFail({ id: 'outbox-due' });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      outboxId: 'outbox-due',
      aggregateId: 'job-due',
      attemptCount: 0,
      message: {
        id: 'message-due',
        name: 'scrape.submit',
        data: { url: 'https://example.com/due' },
      },
    });
    expect(persistedDue.nextAttemptAt.getTime()).toBeGreaterThan(dueBeforeClaim.getTime());
  });

  it('claimBatch respects batchSize and maxAttempts', async () => {
    const outboxRepository = context.dataSource.getRepository(OutboxMessageEntity);
    const dueAt = new Date(Date.now() - 1_000);

    await outboxRepository.save([
      outboxRepository.create({
        id: 'outbox-1',
        aggregateId: 'job-1',
        messageId: 'message-1',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { id: 1 },
        attemptCount: 0,
        publishedAt: null,
        nextAttemptAt: dueAt,
        lastError: null,
      }),
      outboxRepository.create({
        id: 'outbox-2',
        aggregateId: 'job-2',
        messageId: 'message-2',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { id: 2 },
        attemptCount: 1,
        publishedAt: null,
        nextAttemptAt: dueAt,
        lastError: null,
      }),
      outboxRepository.create({
        id: 'outbox-3',
        aggregateId: 'job-3',
        messageId: 'message-3',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { id: 3 },
        attemptCount: 3,
        publishedAt: null,
        nextAttemptAt: dueAt,
        lastError: null,
      }),
    ]);

    const claimed = await service.claimBatch({ batchSize: 1, maxAttempts: 3 });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].outboxId).toBe('outbox-1');
  });

  it('markPublished sets publishedAt clears lastError and resets nextAttemptAt', async () => {
    const outboxRepository = context.dataSource.getRepository(OutboxMessageEntity);
    await outboxRepository.save(
      outboxRepository.create({
        id: 'outbox-publish',
        aggregateId: 'job-publish',
        messageId: 'message-publish',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/publish' },
        attemptCount: 2,
        publishedAt: null,
        nextAttemptAt: new Date(Date.now() - 10_000),
        lastError: 'temporary failure',
      }),
    );

    await service.markPublished('outbox-publish');
    const persisted = await outboxRepository.findOneByOrFail({ id: 'outbox-publish' });

    expect(persisted.publishedAt).not.toBeNull();
    expect(persisted.lastError).toBeNull();
    expect(persisted.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('markJobEnqueuedAndPublished updates the job and outbox row atomically', async () => {
    const jobsRepository = context.dataSource.getRepository(JobEntity);
    const outboxRepository = context.dataSource.getRepository(OutboxMessageEntity);
    await jobsRepository.save(
      jobsRepository.create({
        id: 'job-enqueued',
        url: 'https://example.com/enqueued',
        status: 'SUBMITTED',
        resultPath: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    await outboxRepository.save(
      outboxRepository.create({
        id: 'outbox-enqueued',
        aggregateId: 'job-enqueued',
        messageId: 'message-enqueued',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/enqueued' },
        attemptCount: 0,
        publishedAt: null,
        nextAttemptAt: new Date(Date.now() - 1_000),
        lastError: 'old error',
      }),
    );

    await service.markJobEnqueuedAndPublished('job-enqueued', 'outbox-enqueued');

    const persistedJob = await jobsRepository.findOneByOrFail({ id: 'job-enqueued' });
    const persistedOutbox = await outboxRepository.findOneByOrFail({ id: 'outbox-enqueued' });

    expect(persistedJob.status).toBe('ENQUEUED');
    expect(persistedOutbox.publishedAt).not.toBeNull();
    expect(persistedOutbox.lastError).toBeNull();
  });

  it('markFailed increments attemptCount stores the error and delays the next attempt', async () => {
    const outboxRepository = context.dataSource.getRepository(OutboxMessageEntity);
    await outboxRepository.save(
      outboxRepository.create({
        id: 'outbox-failed',
        aggregateId: 'job-failed',
        messageId: 'message-failed',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/failed' },
        attemptCount: 1,
        publishedAt: null,
        nextAttemptAt: new Date(Date.now() - 2_000),
        lastError: null,
      }),
    );

    const beforeMarkFailed = Date.now();
    await service.markFailed('outbox-failed', 'transient database error');
    const persisted = await outboxRepository.findOneByOrFail({ id: 'outbox-failed' });

    expect(persisted.attemptCount).toBe(2);
    expect(persisted.lastError).toBe('transient database error');
    expect(persisted.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      beforeMarkFailed + options.outboxRetryDelayMs! - 2_000,
    );
  });

  it('deletePublishedBefore deletes only published rows older than the cutoff', async () => {
    const outboxRepository = context.dataSource.getRepository(OutboxMessageEntity);
    const oldPublishedAt = new Date(Date.now() - 60_000);
    const recentPublishedAt = new Date(Date.now() - 10_000);

    await outboxRepository.save([
      outboxRepository.create({
        id: 'outbox-old',
        aggregateId: 'job-old',
        messageId: 'message-old',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/old' },
        attemptCount: 0,
        publishedAt: oldPublishedAt,
        nextAttemptAt: oldPublishedAt,
        lastError: null,
      }),
      outboxRepository.create({
        id: 'outbox-recent',
        aggregateId: 'job-recent',
        messageId: 'message-recent',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/recent' },
        attemptCount: 0,
        publishedAt: recentPublishedAt,
        nextAttemptAt: recentPublishedAt,
        lastError: null,
      }),
      outboxRepository.create({
        id: 'outbox-unpublished',
        aggregateId: 'job-unpublished',
        messageId: 'message-unpublished',
        queueName: 'scrape-job-queue',
        messageName: 'scrape.submit',
        payload: { url: 'https://example.com/unpublished' },
        attemptCount: 0,
        publishedAt: null,
        nextAttemptAt: recentPublishedAt,
        lastError: null,
      }),
    ]);

    const deletedCount = await service.deletePublishedBefore(
      new Date(Date.now() - 30_000),
    );
    const remainingIds = (await outboxRepository.find()).map((row) => row.id).sort();

    expect(deletedCount).toBe(1);
    expect(remainingIds).toEqual(['outbox-recent', 'outbox-unpublished']);
  });
});
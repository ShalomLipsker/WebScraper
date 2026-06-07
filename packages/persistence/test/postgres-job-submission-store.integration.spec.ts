import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobEntity, OutboxMessageEntity } from '../src/lib/persistence.entities.js';
import { PostgresJobSubmissionStore } from '../src/lib/postgres-job-submission-store.js';
import type { PostgresPersistenceModuleOptions } from '../src/lib/persistence.types.js';
import { createPostgresTestContext, type PostgresTestContext } from './postgres-test.utils.js';

describe('PostgresJobSubmissionStore integration', { concurrent: false }, () => {
  let context: PostgresTestContext;
  let store: PostgresJobSubmissionStore;
  let options: PostgresPersistenceModuleOptions;

  beforeAll(async () => {
    context = await createPostgresTestContext({
      label: 'job_submission_store',
      entities: [JobEntity, OutboxMessageEntity],
    });
    options = { jobRetentionSeconds: 3_600 };
    store = new PostgresJobSubmissionStore(context.dataSource, options);
  });

  afterEach(async () => {
    await context.reset();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('createJobSubmissionIfNotExists inserts the job and outbox row in one transaction', async () => {
    const created = await store.createJobSubmissionIfNotExists({
      job: {
        id: 'submission-1',
        url: 'https://example.com/submission-1',
        status: 'SUBMITTED',
      },
      queueName: 'scrape-job-queue',
      message: {
        id: 'message-1',
        name: 'scrape.submit',
        data: { url: 'https://example.com/submission-1' },
      },
    });

    const persistedJob = await context.dataSource.getRepository(JobEntity).findOneByOrFail({
      id: 'submission-1',
    });
    const persistedOutbox = await context.dataSource
      .getRepository(OutboxMessageEntity)
      .findOneByOrFail({ messageId: 'message-1' });

    expect(created).toMatchObject({
      alreadyExisted: false,
      job: {
        id: 'submission-1',
        status: 'SUBMITTED',
      },
    });
    expect(persistedJob.url).toBe('https://example.com/submission-1');
    expect(persistedOutbox).toMatchObject({
      aggregateId: 'submission-1',
      queueName: 'scrape-job-queue',
      messageId: 'message-1',
      messageName: 'scrape.submit',
      attemptCount: 0,
      publishedAt: null,
      lastError: null,
    });
  });

  it('createJobSubmissionIfNotExists reuses the existing job without inserting a duplicate outbox row', async () => {
    await store.createJobSubmissionIfNotExists({
      job: {
        id: 'submission-dup',
        url: 'https://example.com/submission-dup',
        status: 'SUBMITTED',
      },
      queueName: 'scrape-job-queue',
      message: {
        id: 'message-dup-1',
        name: 'scrape.submit',
        data: { url: 'https://example.com/submission-dup' },
      },
    });

    const duplicate = await store.createJobSubmissionIfNotExists({
      job: {
        id: 'submission-dup',
        url: 'https://example.com/submission-dup',
        status: 'SUBMITTED',
      },
      queueName: 'scrape-job-queue',
      message: {
        id: 'message-dup-2',
        name: 'scrape.submit',
        data: { url: 'https://example.com/submission-dup' },
      },
    });

    const outboxRows = await context.dataSource.getRepository(OutboxMessageEntity).count();

    expect(duplicate).toMatchObject({
      alreadyExisted: true,
      job: {
        id: 'submission-dup',
        status: 'SUBMITTED',
      },
    });
    expect(outboxRows).toBe(1);
  });

  it('createJobSubmissionIfNotExists preserves correlation id data in the outbox payload', async () => {
    await store.createJobSubmissionIfNotExists({
      job: {
        id: 'submission-correlation',
        url: 'https://example.com/submission-correlation',
        status: 'SUBMITTED',
      },
      queueName: 'scrape-job-queue',
      message: {
        id: 'message-correlation',
        name: 'scrape.submit',
        data: {
          url: 'https://example.com/submission-correlation',
          correlationId: 'corr-123',
        },
      },
    });

    const persistedOutbox = await context.dataSource
      .getRepository(OutboxMessageEntity)
      .findOneByOrFail({ messageId: 'message-correlation' });

    expect(persistedOutbox.payload).toMatchObject({
      url: 'https://example.com/submission-correlation',
      correlationId: 'corr-123',
    });
  });
});
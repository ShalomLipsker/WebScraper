import 'reflect-metadata';

import { afterEach, describe, expect, it } from 'vitest';

import { JobEntity, OutboxMessageEntity, PostgresJobRepository, PostgresJobSubmissionStore } from '@org/persistence';

import { ScrapeJobsService } from '../src/app/scrape-jobs.service.js';
import { createPostgresTestContext, type PostgresTestContext } from '../../../packages/persistence/test/postgres-test.utils.ts';

describe('ScrapeJobsService integration', { concurrent: false }, () => {
  const contexts = new Set<PostgresTestContext>();

  afterEach(async () => {
    await Promise.all(
      Array.from(contexts, async (context) => {
        await context.cleanup();
        contexts.delete(context);
      }),
    );
  });

  it('submitJob persists the job, creates the outbox row, and getJobStatus returns the stored view', async () => {
    const context = await createPostgresTestContext({
      label: 'job-manager-scrape-jobs',
      entities: [JobEntity, OutboxMessageEntity],
    });
    contexts.add(context);

    const service = createService(context);

    const acknowledgement = await service.submitJob({
      url: 'https://example.com/path',
      correlationId: 'corr-1',
      traceContext: { traceparent: 'trace-1' },
    });

    expect(acknowledgement.accepted).toBe(true);
    expect(acknowledgement.status).toBe('SUBMITTED');
    expect(acknowledgement.url).toBe('https://example.com/path');

    const storedJob = await context.dataSource.getRepository(JobEntity).findOneByOrFail({
      id: acknowledgement.jobId,
    });
    expect(storedJob.status).toBe('SUBMITTED');
    expect(storedJob.url).toBe('https://example.com/path');

    const outboxRow = await context.dataSource
      .getRepository(OutboxMessageEntity)
      .findOneByOrFail({ aggregateId: acknowledgement.jobId });

    expect(outboxRow.queueName).toBe('scrape-job-queue');
    expect(outboxRow.messageName).toBe('scrape.submit');
    expect(outboxRow.payload).toMatchObject({
      url: 'https://example.com/path',
      correlationId: 'corr-1',
      traceContext: { traceparent: 'trace-1' },
    });

    await expect(
      service.getJobStatus({ jobId: acknowledgement.jobId, correlationId: 'corr-2' }),
    ).resolves.toMatchObject({
      jobId: acknowledgement.jobId,
      url: 'https://example.com/path',
      status: 'SUBMITTED',
    });
  });

  it('deduplicates repeated submissions and reuses the current persisted status', async () => {
    const context = await createPostgresTestContext({
      label: 'job-manager-scrape-jobs-dedup',
      entities: [JobEntity, OutboxMessageEntity],
    });
    contexts.add(context);

    const service = createService(context);

    const first = await service.submitJob({ url: 'https://example.com/dedup' });
    const repository = new PostgresJobRepository(
      context.dataSource.getRepository(JobEntity),
      { jobRetentionSeconds: 86_400 },
    );
    await repository.updateJobStatus(first.jobId, 'PROCESSING');

    const second = await service.submitJob({ url: 'https://example.com/dedup' });

    expect(second.jobId).toBe(first.jobId);
    expect(second.status).toBe('PROCESSING');

    const outboxRows = await context.dataSource
      .getRepository(OutboxMessageEntity)
      .findBy({ aggregateId: first.jobId });

    expect(outboxRows).toHaveLength(1);
  });
});

function createService(context: PostgresTestContext): ScrapeJobsService {
  const logger = { log: () => undefined };
  const options = { jobRetentionSeconds: 86_400 };
  const repository = new PostgresJobRepository(
    context.dataSource.getRepository(JobEntity),
    options,
    logger as never,
  );
  const submissionStore = new PostgresJobSubmissionStore(
    context.dataSource,
    options,
    logger as never,
  );

  return new ScrapeJobsService(
    {
      jobQueueName: 'scrape-job-queue',
      statusQueueName: 'scrape-status-queue',
      jobPattern: 'scrape.submit',
      statusPattern: 'scrape.status',
    } as never,
    repository as never,
    submissionStore as never,
    logger as never,
  );
}
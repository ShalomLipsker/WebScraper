import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobEntity } from '../src/lib/persistence.entities.js';
import { PostgresJobRepository } from '../src/lib/postgres-job-repository.js';
import type { PostgresPersistenceModuleOptions } from '../src/lib/persistence.types.js';
import { createPostgresTestContext, type PostgresTestContext } from './postgres-test.utils.js';

describe('PostgresJobRepository integration', { concurrent: false }, () => {
  let context: PostgresTestContext;
  let repository: PostgresJobRepository;
  let options: PostgresPersistenceModuleOptions;

  beforeAll(async () => {
    context = await createPostgresTestContext({
      label: 'job_repository',
      entities: [JobEntity],
    });
    options = { jobRetentionSeconds: 3_600 };
    repository = new PostgresJobRepository(
      context.dataSource.getRepository(JobEntity),
      options,
    );
  });

  afterEach(async () => {
    await context.reset();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('createJob persists a new job with a computed expiration', async () => {
    const beforeCreate = Date.now();
    const created = await repository.createJob({
      id: 'job-create',
      url: 'https://example.com/create',
      status: 'SUBMITTED',
    });
    const persisted = await context.dataSource.getRepository(JobEntity).findOneByOrFail({
      id: 'job-create',
    });

    expect(created).toMatchObject({
      id: 'job-create',
      url: 'https://example.com/create',
      status: 'SUBMITTED',
    });
    expect(persisted.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeCreate + options.jobRetentionSeconds! * 1_000 - 2_000,
    );
  });

  it('createJobIfNotExists creates once and returns alreadyExisted on duplicates', async () => {
    const first = await repository.createJobIfNotExists({
      id: 'job-dedup',
      url: 'https://example.com/dedup',
      status: 'SUBMITTED',
    });
    const second = await repository.createJobIfNotExists({
      id: 'job-dedup',
      url: 'https://example.com/dedup',
      status: 'SUBMITTED',
    });
    const count = await context.dataSource.getRepository(JobEntity).countBy({
      id: 'job-dedup',
    });

    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(count).toBe(1);
  });

  it('getJob returns null for missing jobs and metadata for existing jobs', async () => {
    expect(await repository.getJob('missing-job')).toBeNull();

    await repository.createJob({
      id: 'job-existing',
      url: 'https://example.com/existing',
      status: 'PROCESSING',
    });

    await expect(repository.getJob('job-existing')).resolves.toMatchObject({
      id: 'job-existing',
      url: 'https://example.com/existing',
      status: 'PROCESSING',
    });
  });

  it('findExpiredJobs returns only expired jobs ordered by expiration', async () => {
    const jobsRepository = context.dataSource.getRepository(JobEntity);
    await jobsRepository.save([
      jobsRepository.create({
        id: 'job-expired-older',
        url: 'https://example.com/expired-older',
        status: 'SUBMITTED',
        resultPath: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() - 20_000),
      }),
      jobsRepository.create({
        id: 'job-expired-newer',
        url: 'https://example.com/expired-newer',
        status: 'SUBMITTED',
        resultPath: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() - 10_000),
      }),
      jobsRepository.create({
        id: 'job-future',
        url: 'https://example.com/future',
        status: 'SUBMITTED',
        resultPath: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ]);

    const expired = await repository.findExpiredJobs(10);

    expect(expired.map((job) => job.id)).toEqual([
      'job-expired-older',
      'job-expired-newer',
    ]);
  });

  it('updateJobStatus allows valid forward transitions and refreshes expiration', async () => {
    await repository.createJob({
      id: 'job-forward',
      url: 'https://example.com/forward',
      status: 'SUBMITTED',
    });

    const enqueued = await repository.updateJobStatus('job-forward', 'ENQUEUED');
    const processing = await repository.updateJobStatus('job-forward', 'PROCESSING');
    const completed = await repository.updateJobStatus('job-forward', 'COMPLETED', {
      resultPath: 'scrape-results/job-forward.html',
    });

    expect(enqueued.outcome).toBe('updated');
    expect(processing.outcome).toBe('updated');
    expect(completed).toMatchObject({
      outcome: 'updated',
      job: {
        id: 'job-forward',
        status: 'COMPLETED',
        resultPath: 'scrape-results/job-forward.html',
      },
    });
  });

  it('updateJobStatus blocks invalid terminal-state transitions', async () => {
    await repository.createJob({
      id: 'job-terminal',
      url: 'https://example.com/terminal',
      status: 'SUBMITTED',
    });
    await repository.updateJobStatus('job-terminal', 'COMPLETED', {
      resultPath: 'scrape-results/job-terminal.html',
    });

    const blocked = await repository.updateJobStatus('job-terminal', 'PROCESSING');

    expect(blocked).toMatchObject({
      outcome: 'blocked',
      job: {
        id: 'job-terminal',
        status: 'COMPLETED',
      },
    });
  });

  it('markJobExpired updates non-terminal jobs and blocks terminal jobs', async () => {
    await repository.createJob({
      id: 'job-expirable',
      url: 'https://example.com/expirable',
      status: 'PROCESSING',
    });
    await repository.createJob({
      id: 'job-not-expirable',
      url: 'https://example.com/not-expirable',
      status: 'FAILED',
    });

    const expired = await repository.markJobExpired('job-expirable');
    const blocked = await repository.markJobExpired('job-not-expirable');

    expect(expired).toMatchObject({
      outcome: 'updated',
      job: {
        id: 'job-expirable',
        status: 'EXPIRED',
      },
    });
    expect(blocked).toMatchObject({
      outcome: 'blocked',
      job: {
        id: 'job-not-expirable',
        status: 'FAILED',
      },
    });
  });

  it('deleteJob returns false for missing jobs and true for existing jobs', async () => {
    await repository.createJob({
      id: 'job-delete',
      url: 'https://example.com/delete',
      status: 'SUBMITTED',
    });

    await expect(repository.deleteJob('job-delete')).resolves.toBe(true);
    await expect(repository.deleteJob('job-delete')).resolves.toBe(false);
  });
});
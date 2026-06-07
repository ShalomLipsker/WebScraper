import 'reflect-metadata';

import { createHash } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrapeJobsService } from '../src/app/scrape-jobs.service.js';

describe('ScrapeJobsService', () => {
  let jobRepository: { getJob: ReturnType<typeof vi.fn> };
  let jobSubmissionStore: {
    createJobSubmissionIfNotExists: ReturnType<typeof vi.fn>;
  };
  let service: ScrapeJobsService;

  beforeEach(() => {
    jobRepository = {
      getJob: vi.fn(),
    };
    jobSubmissionStore = {
      createJobSubmissionIfNotExists: vi.fn(),
    };

    service = new ScrapeJobsService(
      {
        jobQueueName: 'scrape-job-queue',
        statusQueueName: 'scrape-status-queue',
        jobPattern: 'scrape.submit',
        statusPattern: 'scrape.status',
      } as never,
      jobRepository as never,
      jobSubmissionStore as never,
      { log: vi.fn() } as never,
    );
  });

  it('submitJob normalizes input and creates the expected job submission payload', async () => {
    const normalizedUrl = 'https://example.com/path';
    const normalizedProxy = 'http://proxy.example.com:8080';
    const jobId = hashJobRequest(normalizedUrl, normalizedProxy);

    jobSubmissionStore.createJobSubmissionIfNotExists.mockResolvedValue({
      alreadyExisted: false,
      job: {
        id: jobId,
        url: normalizedUrl,
        status: 'SUBMITTED',
      },
    });

    await expect(
      service.submitJob({
        url: '  https://example.com/path  ',
        proxy: '  http://proxy.example.com:8080  ',
        correlationId: 'corr-1',
        traceContext: { traceparent: 'trace-1' },
      }),
    ).resolves.toMatchObject({
      accepted: true,
      jobId,
      url: normalizedUrl,
      status: 'SUBMITTED',
    });

    expect(jobSubmissionStore.createJobSubmissionIfNotExists).toHaveBeenCalledWith({
      job: {
        id: jobId,
        url: normalizedUrl,
        status: 'SUBMITTED',
      },
      queueName: 'scrape-job-queue',
      message: {
        id: jobId,
        name: 'scrape.submit',
        data: {
          url: normalizedUrl,
          proxy: normalizedProxy,
          correlationId: 'corr-1',
          traceContext: { traceparent: 'trace-1' },
        },
      },
    });
  });

  it('submitJob returns the persisted status when the job already exists', async () => {
    const jobId = hashJobRequest('https://example.com');

    jobSubmissionStore.createJobSubmissionIfNotExists.mockResolvedValue({
      alreadyExisted: true,
      job: {
        id: jobId,
        url: 'https://example.com',
        status: 'PROCESSING',
      },
    });

    await expect(
      service.submitJob({ url: 'https://example.com' }),
    ).resolves.toMatchObject({
      jobId,
      status: 'PROCESSING',
    });
  });

  it('submitJob rejects invalid urls', async () => {
    await expect(
      service.submitJob({ url: 'ftp://example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submitJob rejects invalid proxies', async () => {
    await expect(
      service.submitJob({
        url: 'https://example.com',
        proxy: 'socks5://proxy.example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getJobStatus returns null when the job is missing', async () => {
    jobRepository.getJob.mockResolvedValue(null);

    await expect(
      service.getJobStatus({ jobId: 'missing-job', correlationId: 'corr-2' }),
    ).resolves.toBeNull();
  });

  it('getJobStatus maps a persisted job to the public status view', async () => {
    jobRepository.getJob.mockResolvedValue({
      id: 'job-1',
      url: 'https://example.com',
      status: 'COMPLETED',
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
      updatedAt: new Date('2026-06-07T00:01:00.000Z'),
      resultPath: 'scrape-results/jobs/job-1.html',
      errorMessage: undefined,
    });

    await expect(
      service.getJobStatus({ jobId: 'job-1' }),
    ).resolves.toEqual({
      jobId: 'job-1',
      url: 'https://example.com',
      status: 'COMPLETED',
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:01:00.000Z',
      resultPath: 'scrape-results/jobs/job-1.html',
      errorMessage: undefined,
    });
  });
});

function hashJobRequest(url: string, proxy?: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ url, proxy: proxy ?? null }))
    .digest('hex');
}

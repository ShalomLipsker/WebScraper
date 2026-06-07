import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpiredJobsCleanupService } from '../src/app/expired-jobs-cleanup.service.js';

describe('ExpiredJobsCleanupService', () => {
  let jobRepository: {
    findExpiredJobs: ReturnType<typeof vi.fn>;
    markJobExpired: ReturnType<typeof vi.fn>;
    deleteJob: ReturnType<typeof vi.fn>;
  };
  let advisoryLockRunner: {
    runWithLock: ReturnType<typeof vi.fn>;
  };
  let storageService: {
    deleteObject: ReturnType<typeof vi.fn>;
  };
  let logger: {
    log: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    jobRepository = {
      findExpiredJobs: vi.fn(),
      markJobExpired: vi.fn(),
      deleteJob: vi.fn(),
    };
    advisoryLockRunner = {
      runWithLock: vi.fn(),
    };
    storageService = {
      deleteObject: vi.fn(),
    };
    logger = {
      log: vi.fn(),
      error: vi.fn(),
    };
  });

  function createService() {
    return new ExpiredJobsCleanupService(
      {
        intervalMinutes: 1,
        batchSize: 100,
      } as never,
      {
        region: 'us-east-1',
        endpoint: undefined,
        forcePathStyle: true,
        accessKeyId: undefined,
        secretAccessKey: undefined,
        defaultBucket: 'scrape-results',
      } as never,
      jobRepository as never,
      advisoryLockRunner as never,
      storageService as never,
      logger as never,
    );
  }

  it('does nothing when the advisory lock is not acquired', async () => {
    const service = createService();
    advisoryLockRunner.runWithLock.mockResolvedValue({ acquired: false });

    await service['deleteExpiredJobs']();

    expect(jobRepository.findExpiredJobs).not.toHaveBeenCalled();
    expect(storageService.deleteObject).not.toHaveBeenCalled();
  });

  it('marks expired jobs, deletes storage, and removes the job record', async () => {
    const service = createService();
    jobRepository.findExpiredJobs.mockResolvedValue([
      {
        id: 'job-1',
        url: 'https://example.com',
        status: 'SUBMITTED',
        resultPath: 'jobs/job-1.html',
      },
    ]);
    jobRepository.markJobExpired.mockResolvedValue({
      outcome: 'updated',
      job: { id: 'job-1', status: 'EXPIRED' },
    });
    storageService.deleteObject.mockResolvedValue(undefined);
    jobRepository.deleteJob.mockResolvedValue(true);
    advisoryLockRunner.runWithLock.mockImplementation(async (_lock, work) => {
      await work();
      return { acquired: true, value: undefined };
    });

    await service['deleteExpiredJobs']();

    expect(storageService.deleteObject).toHaveBeenCalledWith({
      bucket: 'scrape-results',
      key: 'jobs/job-1.html',
    });
    expect(jobRepository.deleteJob).toHaveBeenCalledWith('job-1');
  });

  it('skips storage deletion when the expired job has no result path', async () => {
    const service = createService();
    jobRepository.findExpiredJobs.mockResolvedValue([
      {
        id: 'job-2',
        url: 'https://example.com',
        status: 'FAILED',
        resultPath: undefined,
      },
    ]);
    jobRepository.markJobExpired.mockResolvedValue({
      outcome: 'updated',
      job: { id: 'job-2', status: 'EXPIRED' },
    });
    jobRepository.deleteJob.mockResolvedValue(true);
    advisoryLockRunner.runWithLock.mockImplementation(async (_lock, work) => {
      await work();
      return { acquired: true, value: undefined };
    });

    await service['deleteExpiredJobs']();

    expect(storageService.deleteObject).not.toHaveBeenCalled();
    expect(jobRepository.deleteJob).toHaveBeenCalledWith('job-2');
  });

  it('skips jobs that are already missing when markJobExpired returns not_found', async () => {
    const service = createService();
    jobRepository.findExpiredJobs.mockResolvedValue([
      {
        id: 'job-3',
        url: 'https://example.com',
        status: 'SUBMITTED',
        resultPath: 'jobs/job-3.html',
      },
    ]);
    jobRepository.markJobExpired.mockResolvedValue({
      outcome: 'not_found',
      job: null,
    });
    advisoryLockRunner.runWithLock.mockImplementation(async (_lock, work) => {
      await work();
      return { acquired: true, value: undefined };
    });

    await service['deleteExpiredJobs']();

    expect(storageService.deleteObject).not.toHaveBeenCalled();
    expect(jobRepository.deleteJob).not.toHaveBeenCalled();
  });

  it('continues cleaning the rest of the batch when one job fails', async () => {
    const service = createService();
    jobRepository.findExpiredJobs.mockResolvedValue([
      {
        id: 'job-4',
        url: 'https://example.com/1',
        status: 'SUBMITTED',
        resultPath: 'jobs/job-4.html',
      },
      {
        id: 'job-5',
        url: 'https://example.com/2',
        status: 'SUBMITTED',
        resultPath: undefined,
      },
    ]);
    jobRepository.markJobExpired
      .mockRejectedValueOnce(new Error('mark failed'))
      .mockResolvedValueOnce({
        outcome: 'updated',
        job: { id: 'job-5', status: 'EXPIRED' },
      });
    jobRepository.deleteJob.mockResolvedValue(true);
    advisoryLockRunner.runWithLock.mockImplementation(async (_lock, work) => {
      await work();
      return { acquired: true, value: undefined };
    });

    await service['deleteExpiredJobs']();

    expect(jobRepository.deleteJob).toHaveBeenCalledWith('job-5');
  });
});
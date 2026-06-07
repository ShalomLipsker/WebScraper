import 'reflect-metadata';

import {
  ConflictException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  S3StorageService,
  StorageObjectMissingError,
  StorageServiceError,
} from '@org/storage';
import { ScrapeGatewayService } from '../src/app/scrape-gateway.service.js';

const buildCompletedJobStatusView = (jobId: string, resultPath: string) => ({
  jobId,
  status: 'COMPLETED' as const,
  url: 'https://example.com',
  createdAt: '2026-06-07T00:00:00.000Z',
  updatedAt: '2026-06-07T00:00:01.000Z',
  resultPath,
});

describe('ScrapeGatewayService', () => {
  const jobManagerClient = {
    send: vi.fn(),
  };
  const storageService = {
    getObject: vi.fn(),
    assertObjectExists: vi.fn(),
    createPresignedGetUrl: vi.fn(),
  };
  const logger = {
    log: vi.fn(),
    error: vi.fn(),
  };

  const service = new ScrapeGatewayService(
    {
      host: '127.0.0.1',
      tcpPort: 4001,
      requestTimeoutMs: 5,
    },
    {
      jobQueueName: 'scrape.jobs',
      statusQueueName: 'scrape.status',
      jobPattern: 'scrape.submit',
      statusPattern: 'scrape.status.get',
    },
    {
      region: 'us-east-1',
      endpoint: undefined,
      forcePathStyle: true,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      defaultBucket: 'scrape-results',
      presignTtlSeconds: 300,
    },
    jobManagerClient as never,
    storageService as unknown as S3StorageService,
    logger as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submitJob sends the configured submit pattern to job-manager', async () => {
    jobManagerClient.send.mockReturnValue(
      of({
        jobId: 'job-1',
        status: 'PENDING',
        url: 'https://example.com',
      }),
    );

    await expect(
      service.submitJob({ url: 'https://example.com', correlationId: 'req-1' }),
    ).resolves.toMatchObject({ jobId: 'job-1', status: 'PENDING' });

    expect(jobManagerClient.send).toHaveBeenCalledWith('scrape.submit', {
      url: 'https://example.com',
      correlationId: 'req-1',
    });
  });

  it('getJobStatus sends the configured status pattern to job-manager', async () => {
    jobManagerClient.send.mockReturnValue(
      of({
        jobId: 'job-2',
        status: 'COMPLETED',
        url: 'https://example.com',
        resultPath: 'jobs/job-2/result.html',
      }),
    );

    await expect(
      service.getJobStatus('job-2', 'req-2', { traceparent: 'abc' }),
    ).resolves.toMatchObject({ jobId: 'job-2', status: 'COMPLETED' });

    expect(jobManagerClient.send).toHaveBeenCalledWith('scrape.status.get', {
      jobId: 'job-2',
      correlationId: 'req-2',
      traceContext: { traceparent: 'abc' },
    });
  });

  it('maps timeout-like job-manager failures to GatewayTimeoutException', async () => {
    jobManagerClient.send.mockReturnValue(
      throwError(() => ({ name: 'TimeoutError' })),
    );

    await expect(
      service.submitJob({ url: 'https://example.com' }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('maps other job-manager failures to ServiceUnavailableException', async () => {
    jobManagerClient.send.mockReturnValue(
      throwError(() => new Error('socket closed')),
    );

    await expect(
      service.submitJob({ url: 'https://example.com' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('getCompletedJobStream loads the stored object using the resolved storage location', async () => {
    const body = Readable.from(['<html>ok</html>']);
    storageService.getObject.mockResolvedValue({
      bucket: 'scrape-results',
      key: 'jobs/job-3/result.html',
      body,
      contentType: 'text/html; charset=utf-8',
      contentLength: 15,
    });

    await expect(
      service.getCompletedJobStream(
        buildCompletedJobStatusView('job-3', 'jobs/job-3/result.html'),
      ),
    ).resolves.toMatchObject({
      contentType: 'text/html; charset=utf-8',
      contentLength: 15,
    });

    expect(storageService.getObject).toHaveBeenCalledWith({
      bucket: 'scrape-results',
      key: 'jobs/job-3/result.html',
    });
  });

  it('getCompletedJobPresignedUrl asserts the object exists and returns the presigned result view', async () => {
    storageService.assertObjectExists.mockResolvedValue(undefined);
    storageService.createPresignedGetUrl.mockResolvedValue({
      bucket: 'scrape-results',
      key: 'jobs/job-4/result.html',
      url: 'https://storage.example.com/object',
      expiresAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(
      service.getCompletedJobPresignedUrl(
        buildCompletedJobStatusView('job-4', 'jobs/job-4/result.html'),
      ),
    ).resolves.toMatchObject({
      deliveryMode: 'presigned-url',
      presignedUrl: 'https://storage.example.com/object',
      expiresAt: '2026-06-07T00:00:00.000Z',
    });

    expect(storageService.assertObjectExists).toHaveBeenCalledWith({
      bucket: 'scrape-results',
      key: 'jobs/job-4/result.html',
    });
    expect(storageService.createPresignedGetUrl).toHaveBeenCalledWith({
      bucket: 'scrape-results',
      key: 'jobs/job-4/result.html',
      expiresInSeconds: 300,
      responseContentDisposition: 'inline; filename="job-4.html"',
      responseContentType: 'text/html; charset=utf-8',
    });
  });

  it('maps missing stored results to ConflictException', async () => {
    storageService.getObject.mockRejectedValue(
      new StorageObjectMissingError('scrape-results', 'jobs/job-5/result.html'),
    );

    await expect(
      service.getCompletedJobStream(
        buildCompletedJobStatusView('job-5', 'jobs/job-5/result.html'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps storage service failures to ServiceUnavailableException', async () => {
    storageService.getObject.mockRejectedValue(
      new StorageServiceError(
        'scrape-results',
        'jobs/job-6/result.html',
        'storage unavailable',
      ),
    );

    await expect(
      service.getCompletedJobStream(
        buildCompletedJobStatusView('job-6', 'jobs/job-6/result.html'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('maps unknown storage failures to ServiceUnavailableException', async () => {
    storageService.getObject.mockRejectedValue(new Error('boom'));

    await expect(
      service.getCompletedJobStream(
        buildCompletedJobStatusView('job-7', 'jobs/job-7/result.html'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
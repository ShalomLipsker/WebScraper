import 'reflect-metadata';

import {
  ConflictException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRequestIdMock,
  getActiveTraceContextCarrierMock,
  extractTraceContextCarrierMock,
} = vi.hoisted(() => ({
  getRequestIdMock: vi.fn(),
  getActiveTraceContextCarrierMock: vi.fn(),
  extractTraceContextCarrierMock: vi.fn(),
}));

vi.mock('@org/logger', () => ({
  PinoLoggerService: class PinoLoggerService {},
  getRequestId: getRequestIdMock,
}));

vi.mock('@org/tracing', () => ({
  getActiveTraceContextCarrier: getActiveTraceContextCarrierMock,
  extractTraceContextCarrier: extractTraceContextCarrierMock,
}));

import { ScrapeController } from '../src/app/scrape.controller.js';

describe('ScrapeController', () => {
  const submitJob = vi.fn();
  const getJobStatus = vi.fn();
  const getCompletedJobStream = vi.fn();
  const getCompletedJobPresignedUrl = vi.fn();
  const logger = { log: vi.fn() };

  const gateway = {
    submitJob,
    getJobStatus,
    getCompletedJobStream,
    getCompletedJobPresignedUrl,
  };

  const controller = new ScrapeController(gateway as never, logger as never);

  beforeEach(() => {
    vi.clearAllMocks();
    getRequestIdMock.mockReturnValue('req-1');
    getActiveTraceContextCarrierMock.mockReturnValue({ traceparent: 'active' });
    extractTraceContextCarrierMock.mockReturnValue({ traceparent: 'header' });
  });

  it('submit forwards the payload with correlation id and preferred active trace context', async () => {
    submitJob.mockResolvedValue({
      jobId: 'job-1',
      status: 'PENDING',
      url: 'https://example.com',
    });

    await expect(
      controller.submit(
        { id: 'req-1', headers: { traceparent: 'header' } },
        { url: 'https://example.com', proxy: 'http://proxy.example.com:8080' },
      ),
    ).resolves.toMatchObject({
      jobId: 'job-1',
      status: 'PENDING',
    });

    expect(submitJob).toHaveBeenCalledWith({
      url: 'https://example.com',
      proxy: 'http://proxy.example.com:8080',
      correlationId: 'req-1',
      traceContext: { traceparent: 'active' },
    });
    expect(extractTraceContextCarrierMock).not.toHaveBeenCalled();
  });

  it('getJobStatus throws not found when the gateway returns null', async () => {
    getActiveTraceContextCarrierMock.mockReturnValue(undefined);
    getJobStatus.mockResolvedValue(null);

    await expect(
      controller.getJobStatus(
        { id: 'req-2', headers: { traceparent: 'header' } },
        'job-2',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(extractTraceContextCarrierMock).toHaveBeenCalledWith({
      traceparent: 'header',
    });
  });

  it('getScrapedHtml throws gone when the job is expired', async () => {
    getJobStatus.mockResolvedValue({
      jobId: 'job-3',
      status: 'EXPIRED',
      url: 'https://example.com',
    });

    await expect(
      controller.getScrapedHtml(
        { id: 'req-3', headers: {} },
        'job-3',
        { setHeader: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('getScrapedHtml throws conflict when the job is not completed', async () => {
    getJobStatus.mockResolvedValue({
      jobId: 'job-4',
      status: 'RUNNING',
      url: 'https://example.com',
    });

    await expect(
      controller.getScrapedHtml(
        { id: 'req-4', headers: {} },
        'job-4',
        { setHeader: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('getScrapedHtml throws internal server error when a completed job is missing its storage path', async () => {
    getJobStatus.mockResolvedValue({
      jobId: 'job-5',
      status: 'COMPLETED',
      url: 'https://example.com',
      resultPath: undefined,
    });

    await expect(
      controller.getScrapedHtml(
        { id: 'req-5', headers: {} },
        'job-5',
        { setHeader: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('getScrapedHtml sets headers and returns a streamable file for completed jobs', async () => {
    const setHeader = vi.fn();
    const body = Readable.from(['<html>ok</html>']);

    getJobStatus.mockResolvedValue({
      jobId: 'job-6',
      status: 'COMPLETED',
      url: 'https://example.com',
      resultPath: 'jobs/job-6/result.html',
    });
    getCompletedJobStream.mockResolvedValue({
      body,
      contentType: 'text/html; charset=utf-8',
      contentLength: 15,
    });

    const result = await controller.getScrapedHtml(
      { id: 'req-6', headers: {} },
      'job-6',
      { setHeader },
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(setHeader).toHaveBeenNthCalledWith(1, 'Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenNthCalledWith(2, 'Content-Length', '15');
    expect(result.getHeaders()).toMatchObject({
      type: 'text/html; charset=utf-8',
      disposition: 'inline; filename="job-6.html"',
    });
  });

  it('getScrapedHtmlUrl returns the gateway presigned-url view for completed jobs', async () => {
    getJobStatus.mockResolvedValue({
      jobId: 'job-7',
      status: 'COMPLETED',
      url: 'https://example.com',
      resultPath: 'jobs/job-7/result.html',
    });
    getCompletedJobPresignedUrl.mockResolvedValue({
      jobId: 'job-7',
      status: 'COMPLETED',
      url: 'https://example.com',
      resultPath: 'jobs/job-7/result.html',
      deliveryMode: 'presigned-url',
      presignedUrl: 'https://storage.example.com/object',
      expiresAt: '2026-06-07T00:00:00.000Z',
    });

    await expect(
      controller.getScrapedHtmlUrl({ id: 'req-7', headers: {} }, 'job-7'),
    ).resolves.toMatchObject({
      deliveryMode: 'presigned-url',
      presignedUrl: 'https://storage.example.com/object',
    });
  });
});
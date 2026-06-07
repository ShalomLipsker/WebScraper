import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractTraceContextCarrierMock,
  getActiveTraceContextCarrierMock,
  getTraceContextHeadersMock,
  withTraceContextMock,
} = vi.hoisted(() => ({
  extractTraceContextCarrierMock: vi.fn(),
  getActiveTraceContextCarrierMock: vi.fn(),
  getTraceContextHeadersMock: vi.fn(),
  withTraceContextMock: vi.fn(async (_traceContext, work: () => Promise<unknown>) => work()),
}));

vi.mock('@org/tracing', () => ({
  extractTraceContextCarrier: extractTraceContextCarrierMock,
  getActiveTraceContextCarrier: getActiveTraceContextCarrierMock,
  getTraceContextHeaders: getTraceContextHeadersMock,
  withTraceContext: withTraceContextMock,
}));

import { ScrapeWorkerService } from '../src/app/scrape-worker.service.js';

describe('ScrapeWorkerService', () => {
  let registerHandler: ReturnType<typeof vi.fn>;
  let workerClose: ReturnType<typeof vi.fn>;
  let statusPublish: ReturnType<typeof vi.fn>;
  let fetchHtml: ReturnType<typeof vi.fn>;
  let putText: ReturnType<typeof vi.fn>;
  let logger: {
    log: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    workerClose = vi.fn().mockResolvedValue(undefined);
    registerHandler = vi.fn().mockResolvedValue({ close: workerClose });
    statusPublish = vi.fn().mockResolvedValue(undefined);
    fetchHtml = vi.fn();
    putText = vi.fn().mockResolvedValue(undefined);
    logger = {
      log: vi.fn(),
      error: vi.fn(),
    };

    extractTraceContextCarrierMock.mockReset();
    getActiveTraceContextCarrierMock.mockReset();
    getTraceContextHeadersMock.mockReset();
    withTraceContextMock.mockClear();

    getActiveTraceContextCarrierMock.mockReturnValue({ traceparent: 'active-trace' });
    getTraceContextHeadersMock.mockImplementation((carrier?: Record<string, string>) => {
      if (!carrier?.traceparent) {
        return {};
      }

      return { traceparent: carrier.traceparent };
    });
    withTraceContextMock.mockImplementation(async (_traceContext, work) => work());
  });

  function createService() {
    return new ScrapeWorkerService(
      {
        jobQueueName: 'scrape-job-queue',
        statusQueueName: 'scrape-status-queue',
        jobPattern: 'scrape.submit',
        statusPattern: 'scrape.status',
      } as never,
      { registerHandler } as never,
      { publish: statusPublish } as never,
      logger as never,
      { fetchHtml } as never,
      { putText } as never,
    );
  }

  async function registerAndGetHandler() {
    const service = createService();
    await service.onModuleInit();
    const handler = registerHandler.mock.calls[0]?.[0];

    if (!handler) {
      throw new Error('Expected scrape worker handler to be registered.');
    }

    return {
      service,
      handler: handler as (message: any) => Promise<unknown>,
    };
  }

  it('ignores messages whose name does not match the configured job pattern', async () => {
    const { handler } = await registerAndGetHandler();

    await expect(
      handler({
        id: 'job-1',
        name: 'other.pattern',
        data: { url: 'https://example.com' },
        attemptsMade: 0,
        maxAttempts: 3,
        timestamp: Date.now(),
        headers: {},
      }),
    ).resolves.toEqual({ status: 'IGNORED' });

    expect(fetchHtml).not.toHaveBeenCalled();
    expect(statusPublish).not.toHaveBeenCalled();
  });

  it('publishes processing and completed statuses around a successful scrape', async () => {
    const { handler } = await registerAndGetHandler();
    extractTraceContextCarrierMock.mockReturnValue({ traceparent: 'header-trace' });
    fetchHtml.mockResolvedValue('<html>done</html>');

    await expect(
      handler({
        id: 'job-1',
        name: 'scrape.submit',
        correlationId: 'corr-1',
        data: {
          url: 'https://example.com',
          proxy: 'http://proxy.example.com:8080',
          traceContext: { traceparent: 'payload-trace' },
        },
        attemptsMade: 0,
        maxAttempts: 3,
        timestamp: Date.now(),
        headers: { traceparent: 'header-trace' },
      }),
    ).resolves.toEqual({
      status: 'COMPLETED',
      resultPath: 'scrape-results/job-1.html',
    });

    expect(fetchHtml).toHaveBeenCalledWith(
      'https://example.com',
      'http://proxy.example.com:8080',
      {
        jobId: 'job-1',
        correlationId: 'corr-1',
      },
    );
    expect(putText).toHaveBeenCalledWith({
      key: 'scrape-results/job-1.html',
      body: '<html>done</html>',
      contentType: 'text/html; charset=utf-8',
      metadata: {
        jobId: 'job-1',
        sourceUrl: 'https://example.com',
      },
    });
    expect(statusPublish).toHaveBeenNthCalledWith(
      1,
      {
        id: 'job-1-processing',
        name: 'scrape.status',
        data: {
          jobId: 'job-1',
          correlationId: 'corr-1',
          status: 'PROCESSING',
          traceContext: { traceparent: 'active-trace' },
        },
      },
      {
        correlationId: 'corr-1',
        headers: { traceparent: 'active-trace' },
      },
    );
    expect(statusPublish).toHaveBeenNthCalledWith(
      2,
      {
        id: 'job-1-completed',
        name: 'scrape.status',
        data: {
          jobId: 'job-1',
          correlationId: 'corr-1',
          status: 'COMPLETED',
          resultPath: 'scrape-results/job-1.html',
          traceContext: { traceparent: 'active-trace' },
        },
      },
      {
        correlationId: 'corr-1',
        headers: { traceparent: 'active-trace' },
      },
    );
  });

  it('rethrows scrape failures before the final attempt without publishing failed status', async () => {
    const { handler } = await registerAndGetHandler();
    fetchHtml.mockRejectedValue(new Error('network failed'));

    await expect(
      handler({
        id: 'job-2',
        name: 'scrape.submit',
        correlationId: 'corr-2',
        data: { url: 'https://example.com' },
        attemptsMade: 0,
        maxAttempts: 3,
        timestamp: Date.now(),
        headers: {},
      }),
    ).rejects.toThrow('network failed');

    expect(statusPublish).toHaveBeenCalledTimes(1);
    expect(statusPublish.mock.calls[0]?.[0]?.data?.status).toBe('PROCESSING');
    expect(statusPublish.mock.calls.some((call) => call[0]?.data?.status === 'FAILED')).toBe(false);
  });

  it('publishes failed status on the final attempt before rethrowing the scrape error', async () => {
    const { handler } = await registerAndGetHandler();
    fetchHtml.mockRejectedValue(new Error('final failure'));

    await expect(
      handler({
        id: 'job-3',
        name: 'scrape.submit',
        correlationId: 'corr-3',
        data: { url: 'https://example.com/final' },
        attemptsMade: 2,
        maxAttempts: 3,
        timestamp: Date.now(),
        headers: {},
      }),
    ).rejects.toThrow('final failure');

    expect(statusPublish).toHaveBeenCalledTimes(2);
    expect(statusPublish).toHaveBeenNthCalledWith(
      2,
      {
        id: 'job-3-failed',
        name: 'scrape.status',
        data: {
          jobId: 'job-3',
          correlationId: 'corr-3',
          status: 'FAILED',
          errorMessage: 'final failure',
          traceContext: { traceparent: 'active-trace' },
        },
      },
      {
        correlationId: 'corr-3',
        headers: { traceparent: 'active-trace' },
      },
    );
  });

  it('fails immediately when the initial status publish fails', async () => {
    const { handler } = await registerAndGetHandler();
    statusPublish.mockRejectedValue(new Error('publish failed'));

    await expect(
      handler({
        id: 'job-4',
        name: 'scrape.submit',
        correlationId: 'corr-4',
        data: { url: 'https://example.com' },
        attemptsMade: 0,
        maxAttempts: 3,
        timestamp: Date.now(),
        headers: {},
      }),
    ).rejects.toThrow('publish failed');

    expect(fetchHtml).not.toHaveBeenCalled();
    expect(statusPublish).toHaveBeenCalledTimes(1);
  });

  it('closes the worker on module destroy', async () => {
    const { service } = await registerAndGetHandler();

    await service.onModuleDestroy();

    expect(workerClose).toHaveBeenCalledTimes(1);
  });
});
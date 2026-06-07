import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractTraceContextCarrierMock,
  withTraceContextMock,
} = vi.hoisted(() => ({
  extractTraceContextCarrierMock: vi.fn(),
  withTraceContextMock: vi.fn(async (_traceContext, work: () => Promise<unknown>) => work()),
}));

vi.mock('@org/tracing', () => ({
  extractTraceContextCarrier: extractTraceContextCarrierMock,
  withTraceContext: withTraceContextMock,
}));

import { ScrapeJobStatusUpdatesService } from '../src/app/scrape-job-status-updates.service.js';

describe('ScrapeJobStatusUpdatesService', () => {
  let registerHandler: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let updateJobStatus: ReturnType<typeof vi.fn>;
  let logger: {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    close = vi.fn().mockResolvedValue(undefined);
    registerHandler = vi.fn().mockResolvedValue({ close });
    updateJobStatus = vi.fn();
    logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };
    extractTraceContextCarrierMock.mockReset();
    withTraceContextMock.mockClear();
    withTraceContextMock.mockImplementation(async (_traceContext, work) => work());
  });

  function createService() {
    return new ScrapeJobStatusUpdatesService(
      {
        jobQueueName: 'scrape-job-queue',
        statusQueueName: 'scrape-status-queue',
        jobPattern: 'scrape.submit',
        statusPattern: 'scrape.status',
      } as never,
      { registerHandler } as never,
      { updateJobStatus } as never,
      logger as never,
    );
  }

  async function registerAndGetHandler() {
    const service = createService();
    await service.onModuleInit();
    const handler = registerHandler.mock.calls[0]?.[0];

    if (!handler) {
      throw new Error('Expected status queue handler to be registered.');
    }

    return { service, handler: handler as (message: any) => Promise<unknown> };
  }

  it('ignores messages whose name does not match the configured status pattern', async () => {
    const { handler } = await registerAndGetHandler();

    await expect(
      handler({
        id: 'message-1',
        name: 'other.pattern',
        data: { jobId: 'job-1', status: 'COMPLETED' },
        attemptsMade: 0,
        maxAttempts: 1,
        timestamp: Date.now(),
        headers: {},
      }),
    ).resolves.toEqual({ status: 'IGNORED' });

    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it('applies a matching status update', async () => {
    const { handler } = await registerAndGetHandler();
    updateJobStatus.mockResolvedValue({
      outcome: 'updated',
      job: { id: 'job-1', status: 'COMPLETED' },
    });

    await expect(
      handler({
        id: 'message-1',
        name: 'scrape.status',
        data: {
          jobId: 'job-1',
          status: 'COMPLETED',
          resultPath: 'jobs/job-1.html',
          correlationId: 'corr-1',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        timestamp: Date.now(),
        headers: {},
      }),
    ).resolves.toEqual({ status: 'UPDATED' });

    expect(updateJobStatus).toHaveBeenCalledWith('job-1', 'COMPLETED', {
      resultPath: 'jobs/job-1.html',
      errorMessage: undefined,
    });
  });

  it('closes the registered worker on module destroy', async () => {
    const { service } = await registerAndGetHandler();

    await service.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
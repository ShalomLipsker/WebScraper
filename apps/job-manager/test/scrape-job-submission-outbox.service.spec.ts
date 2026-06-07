import 'reflect-metadata';

import {
  RABBITMQ_BAGGAGE_HEADER,
  RABBITMQ_CORRELATION_ID_HEADER,
  RABBITMQ_DEDUPLICATION_HEADER,
  RABBITMQ_TRACEPARENT_HEADER,
  RABBITMQ_TRACESTATE_HEADER,
} from '@org/messaging';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrapeJobSubmissionOutboxService } from '../src/app/scrape-job-submission-outbox.service.js';

describe('ScrapeJobSubmissionOutboxService', () => {
  let outboxStore: {
    claimBatch: ReturnType<typeof vi.fn>;
    markJobEnqueuedAndPublished: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  let messageQueue: {
    publish: ReturnType<typeof vi.fn>;
  };
  let pollingWorker: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let logger: {
    log: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    outboxStore = {
      claimBatch: vi.fn(),
      markJobEnqueuedAndPublished: vi.fn(),
      markFailed: vi.fn(),
    };
    messageQueue = {
      publish: vi.fn(),
    };
    pollingWorker = {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    logger = {
      log: vi.fn(),
      error: vi.fn(),
    };
  });

  function createService(maxAttempts = 3) {
    return new ScrapeJobSubmissionOutboxService(
      {
        pollIntervalMs: 1_000,
        batchSize: 10,
        cleanupIntervalMs: 60_000,
        cleanupTtlMs: 86_400_000,
        dispatchConcurrency: 2,
        maxAttempts,
        publishTimeoutMs: 1_000,
        stateUpdateTimeoutMs: 1_000,
      } as never,
      outboxStore as never,
      messageQueue as never,
      pollingWorker as never,
      logger as never,
    );
  }

  it('does nothing when claimBatch returns no messages', async () => {
    const service = createService();
    outboxStore.claimBatch.mockResolvedValue([]);

    await service['processBatch']();

    expect(messageQueue.publish).not.toHaveBeenCalled();
    expect(outboxStore.markJobEnqueuedAndPublished).not.toHaveBeenCalled();
  });

  it('publishes a claimed message with correlation and trace headers then marks it published', async () => {
    const service = createService();
    outboxStore.claimBatch.mockResolvedValue([
      {
        outboxId: 'outbox-1',
        aggregateId: 'job-1',
        queueName: 'scrape-job-queue',
        attemptCount: 0,
        message: {
          id: 'message-1',
          name: 'scrape.submit',
          data: {
            url: 'https://example.com',
            correlationId: 'corr-1',
            traceContext: {
              traceparent: 'trace-1',
              tracestate: 'state-1',
              baggage: 'bag-1',
            },
          },
        },
      },
    ]);
    messageQueue.publish.mockResolvedValue(undefined);
    outboxStore.markJobEnqueuedAndPublished.mockResolvedValue(undefined);

    await service['processBatch']();

    expect(messageQueue.publish).toHaveBeenCalledWith(
      {
        id: 'message-1',
        name: 'scrape.submit',
        data: {
          url: 'https://example.com',
          correlationId: 'corr-1',
          traceContext: {
            traceparent: 'trace-1',
            tracestate: 'state-1',
            baggage: 'bag-1',
          },
        },
      },
      {
        correlationId: 'corr-1',
        headers: {
          [RABBITMQ_DEDUPLICATION_HEADER]: 'message-1',
          [RABBITMQ_CORRELATION_ID_HEADER]: 'corr-1',
          [RABBITMQ_TRACEPARENT_HEADER]: 'trace-1',
          [RABBITMQ_TRACESTATE_HEADER]: 'state-1',
          [RABBITMQ_BAGGAGE_HEADER]: 'bag-1',
        },
      },
    );
    expect(outboxStore.markJobEnqueuedAndPublished).toHaveBeenCalledWith(
      'job-1',
      'outbox-1',
    );
  });

  it('records a failed publish attempt', async () => {
    const service = createService();
    outboxStore.claimBatch.mockResolvedValue([
      {
        outboxId: 'outbox-2',
        aggregateId: 'job-2',
        queueName: 'scrape-job-queue',
        attemptCount: 0,
        message: {
          id: 'message-2',
          name: 'scrape.submit',
          data: { url: 'https://example.com' },
        },
      },
    ]);
    messageQueue.publish.mockRejectedValue(new Error('publish failed'));
    outboxStore.markFailed.mockResolvedValue(undefined);

    await service['processBatch']();

    expect(outboxStore.markFailed).toHaveBeenCalledWith(
      'outbox-2',
      'publish failed',
    );
  });

  it('starts and stops the polling worker with the module lifecycle', async () => {
    const service = createService();

    service.onModuleInit();
    expect(pollingWorker.start).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(pollingWorker.stop).toHaveBeenCalledTimes(1);
  });
});
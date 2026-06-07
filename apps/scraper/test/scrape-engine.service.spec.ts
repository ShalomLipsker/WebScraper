import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  axiosGetMock,
  getActiveTraceContextCarrierMock,
  getTraceContextHeadersMock,
} = vi.hoisted(() => ({
  axiosGetMock: vi.fn(),
  getActiveTraceContextCarrierMock: vi.fn(),
  getTraceContextHeadersMock: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: (value: unknown) => {
      return Boolean(value) && typeof value === 'object' && (value as { isAxiosError?: boolean }).isAxiosError === true;
    },
  },
  isAxiosError: (value: unknown) => {
    return Boolean(value) && typeof value === 'object' && (value as { isAxiosError?: boolean }).isAxiosError === true;
  },
}));

vi.mock('@org/tracing', () => ({
  getActiveTraceContextCarrier: getActiveTraceContextCarrierMock,
  getTraceContextHeaders: getTraceContextHeadersMock,
}));

import { ScrapeEngineService } from '../src/app/scrape-engine.service.js';

describe('ScrapeEngineService', () => {
  let logger: {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    axiosGetMock.mockReset();
    getActiveTraceContextCarrierMock.mockReset();
    getTraceContextHeadersMock.mockReset();
    getActiveTraceContextCarrierMock.mockReturnValue({ traceparent: 'active-trace' });
    getTraceContextHeadersMock.mockImplementation((carrier?: Record<string, string>) => {
      if (!carrier?.traceparent) {
        return {};
      }

      return { traceparent: carrier.traceparent };
    });
  });

  function createService(overrides: Partial<{
    requestTimeoutMs: number;
    maxRetryAttempts: number;
    maxConcurrentRequests: number;
    minRequestIntervalMs: number;
    baseRetryDelayMs: number;
    userAgents: string[];
  }> = {}) {
    return new ScrapeEngineService(
      {
        requestTimeoutMs: 1_500,
        maxRetryAttempts: 3,
        maxConcurrentRequests: 2,
        minRequestIntervalMs: 0,
        baseRetryDelayMs: 0,
        userAgents: ['agent-1', 'agent-2'],
        ...overrides,
      } as never,
      logger as never,
    );
  }

  it('fetchHtml sends the expected request shape including proxy and trace headers', async () => {
    const service = createService();
    axiosGetMock.mockResolvedValue({
      status: 200,
      data: '<html>ok</html>',
    });

    await expect(
      service.fetchHtml('https://example.com/page', 'http://user:pass@proxy.example.com:8080', {
        jobId: 'job-1',
        correlationId: 'corr-1',
      }),
    ).resolves.toBe('<html>ok</html>');

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({
        responseType: 'text',
        timeout: 1_500,
        headers: expect.objectContaining({
          'user-agent': 'agent-1',
          traceparent: 'active-trace',
        }),
        proxy: {
          protocol: 'http',
          host: 'proxy.example.com',
          port: 8080,
          auth: {
            username: 'user',
            password: 'pass',
          },
        },
      }),
    );
  });

  it('retries retryable failures and rotates the user agent on the next attempt', async () => {
    const service = createService();
    axiosGetMock
      .mockRejectedValueOnce(createAxiosError(503, 'Service Unavailable'))
      .mockResolvedValueOnce({
        status: 200,
        data: '<html>retried</html>',
      });

    await expect(
      service.fetchHtml('https://example.com/retry'),
    ).resolves.toBe('<html>retried</html>');

    expect(axiosGetMock).toHaveBeenCalledTimes(2);
    expect(axiosGetMock.mock.calls[0]?.[1]?.headers?.['user-agent']).toBe('agent-1');
    expect(axiosGetMock.mock.calls[1]?.[1]?.headers?.['user-agent']).toBe('agent-2');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'retrying scrape request',
        statusCode: 503,
        retryDelayMs: 0,
      }),
    );
  });

  it('throws a wrapped final error after retry exhaustion', async () => {
    const service = createService();
    axiosGetMock.mockRejectedValue(new Error('socket hang up'));

    await expect(
      service.fetchHtml('https://example.com/missing'),
    ).rejects.toThrow('Failed to fetch HTML for https://example.com/missing: socket hang up');

    expect(axiosGetMock).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'failed scrape request',
        statusCode: null,
        errorMessage: 'socket hang up',
      }),
    );
  });
});

function createAxiosError(status: number, statusText: string) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: {
      status,
      statusText,
    },
  };
}
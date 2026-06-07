import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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

import { PinoLoggerService } from '@org/logger';
import { ScrapeController } from '../src/app/scrape.controller.js';
import { ScrapeGatewayService } from '../src/app/scrape-gateway.service.js';

describe('ScrapeController HTTP integration', () => {
  const submitJob = vi.fn();
  let app: import('@nestjs/common').INestApplication;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    getRequestIdMock.mockReturnValue('req-http-1');
    getActiveTraceContextCarrierMock.mockReturnValue(undefined);
    extractTraceContextCarrierMock.mockReturnValue({ traceparent: 'header' });

    const moduleRef = await Test.createTestingModule({
      controllers: [ScrapeController],
      providers: [
        {
          provide: ScrapeGatewayService,
          useValue: {
            submitJob,
            getJobStatus: vi.fn(),
            getCompletedJobStream: vi.fn(),
            getCompletedJobPresignedUrl: vi.fn(),
          },
        },
        {
          provide: PinoLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0);

    const address = app.getHttpServer().address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine API test server address.');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /scrape returns 202 and routes validated input to the gateway', async () => {
    submitJob.mockResolvedValue({
      jobId: 'job-http-1',
      status: 'PENDING',
      url: 'https://example.com/path',
    });

    const response = await fetch(`${baseUrl}/scrape`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        traceparent: '00-http',
      },
      body: JSON.stringify({
        url: '  https://example.com/path  ',
        proxy: '  ',
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      jobId: 'job-http-1',
      status: 'PENDING',
      url: 'https://example.com/path',
    });
    expect(submitJob).toHaveBeenCalledWith({
      url: 'https://example.com/path',
      proxy: undefined,
      correlationId: 'req-http-1',
      traceContext: { traceparent: 'header' },
    });
  });

  it('POST /scrape rejects invalid payloads through the Nest validation pipe', async () => {
    const response = await fetch(`${baseUrl}/scrape`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url: 'not-a-url',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
    });
    expect(submitJob).not.toHaveBeenCalled();
  });
});
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import axios, { type AxiosProxyConfig, type AxiosRequestConfig } from 'axios';
import { PinoLoggerService, getDurationMs } from '@org/logger';
import { scraperFetchConfig } from './app.config';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

@Injectable()
export class ScrapeEngineService {
  private activeRequests = 0;
  private nextRequestAt = 0;
  private readonly waitQueue: Array<() => void> = [];
  private userAgentIndex = 0;

  constructor(
    @Inject(scraperFetchConfig.KEY)
    private readonly fetchConfig: ConfigType<typeof scraperFetchConfig>,
    private readonly logger: PinoLoggerService,
  ) {}

  async fetchHtml(
    url: string,
    proxy?: string,
    context: { jobId?: string; correlationId?: string } = {},
  ): Promise<string> {
    let lastError: unknown;
    const { fetchConfig } = this;
    const proxyConfig = proxy ? this.createProxyConfig(proxy) : undefined;
    const proxyLabel = this.getProxyLabel(proxy);

    for (let attempt = 1; attempt <= fetchConfig.maxRetryAttempts; attempt += 1) {
      const userAgent = this.nextUserAgent();
      const releaseSlot = await this.acquireRequestSlot();
      const requestStartedAt = Date.now();
      const loggerContext = {
        correlationId: context.correlationId,
        jobId: context.jobId,
        sourceUrl: url,
        attempt,
        maxAttempts: fetchConfig.maxRetryAttempts,
        usedProxy: Boolean(proxyLabel),
        proxy: proxyLabel ?? undefined,
      };

      try {
        this.logger.log({
          ...loggerContext,
          event: 'starting scrape request',
          userAgent,
        });

        const requestConfig: AxiosRequestConfig<string> = {
          responseType: 'text',
          timeout: fetchConfig.requestTimeoutMs,
          maxRedirects: 5,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          transformResponse: [(value: string) => value],
          validateStatus: (status: number) => status >= 200 && status < 400,
        };

        if (proxyConfig) {
          requestConfig.proxy = proxyConfig;
        }

        const response = await axios.get<string>(url, requestConfig);

        const html = typeof response.data === 'string'
          ? response.data
          : String(response.data);

        this.logger.log({
          ...loggerContext,
          event: 'completed scrape request',
          statusCode: response.status,
          htmlLength: html.length,
          durationMs: getDurationMs(requestStartedAt),
        });

        return html;
      } catch (error: unknown) {
        lastError = error;
        const errorMessage = this.getErrorMessage(error);
        const statusCode = this.getStatusCode(error);
        const shouldRetry =
          attempt < fetchConfig.maxRetryAttempts && this.shouldRetry(error);

        if (shouldRetry) {
          const retryDelayMs = this.getRetryDelayMs(attempt, statusCode);

          this.logger.warn({
            ...loggerContext,
            event: 'retrying scrape request',
            statusCode,
            retryDelayMs,
            errorMessage,
          });

          await this.delay(retryDelayMs);
          continue;
        }

        this.logger.error({
          ...loggerContext,
          event: 'failed scrape request',
          statusCode,
          errorMessage,
        });
      } finally {
        releaseSlot();
      }
    }

    throw new Error(
      `Failed to fetch HTML for ${url}: ${this.getErrorMessage(lastError)}`,
    );
  }

  private async acquireRequestSlot(): Promise<() => void> {
    while (this.activeRequests >= this.fetchConfig.maxConcurrentRequests) {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    this.activeRequests += 1;

    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt =
      Math.max(this.nextRequestAt, Date.now())
      + this.fetchConfig.minRequestIntervalMs;

    if (waitMs > 0) {
      await this.delay(waitMs);
    }

    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeRequests -= 1;
      const next = this.waitQueue.shift();
      next?.();
    };
  }

  private nextUserAgent(): string {
    const { userAgents } = this.fetchConfig;
    const userAgent = userAgents[this.userAgentIndex % userAgents.length];

    this.userAgentIndex += 1;

    return userAgent;
  }

  private createProxyConfig(proxy: string): AxiosProxyConfig {
    const parsedProxy = new URL(proxy);
    const defaultPort = parsedProxy.protocol === 'https:' ? 443 : 80;

    return {
      protocol: parsedProxy.protocol.slice(0, -1),
      host: parsedProxy.hostname,
      port: parsedProxy.port ? Number(parsedProxy.port) : defaultPort,
      auth:
        parsedProxy.username || parsedProxy.password
          ? {
            username: decodeURIComponent(parsedProxy.username),
            password: decodeURIComponent(parsedProxy.password),
          }
          : undefined,
    };
  }

  private getProxyLabel(proxy?: string): string | null {
    if (!proxy) {
      return null;
    }

    const parsedProxy = new URL(proxy);
    const defaultPort = parsedProxy.protocol === 'https:' ? '443' : '80';
    const port = parsedProxy.port || defaultPort;

    return `${parsedProxy.protocol}//${parsedProxy.hostname}:${port}`;
  }

  private shouldRetry(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    if (!error.response) {
      return true;
    }

    return RETRYABLE_STATUS_CODES.has(error.response.status);
  }

  private getRetryDelayMs(
    attempt: number,
    statusCode: number | null,
  ): number {
    const baseRetryDelayMs = this.fetchConfig.baseRetryDelayMs;

    if (statusCode === 429) {
      return baseRetryDelayMs * attempt * 2;
    }

    return baseRetryDelayMs * 2 ** (attempt - 1);
  }

  private getStatusCode(error: unknown): number | null {
    if (!axios.isAxiosError(error)) {
      return null;
    }

    return error.response?.status ?? null;
  }

  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return `HTTP ${error.response.status} ${error.response.statusText}`;
      }

      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error';
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
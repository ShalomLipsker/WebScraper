import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PinoLoggerService } from '@org/logger';
import { getAppConfig, type ScraperConfig } from './app.config';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

@Injectable()
export class ScrapeEngineService {
  private activeRequests = 0;
  private nextRequestAt = 0;
  private readonly waitQueue: Array<() => void> = [];
  private userAgentIndex = 0;
  private readonly appConfig: ScraperConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLoggerService,
  ) {
    this.appConfig = getAppConfig(this.configService);
  }

  async fetchHtml(url: string): Promise<string> {
    let lastError: unknown;
    const fetchConfig = this.appConfig.fetch;

    for (let attempt = 1; attempt <= fetchConfig.maxRetryAttempts; attempt += 1) {
      const userAgent = this.nextUserAgent();
      const releaseSlot = await this.acquireRequestSlot();

      try {
        this.logger.log(
          `starting scrape request for ${url} (attempt ${attempt}/${fetchConfig.maxRetryAttempts}) with user-agent ${userAgent}`,
        );

        const response = await axios.get<string>(url, {
          responseType: 'text',
          timeout: fetchConfig.requestTimeoutMs,
          maxRedirects: 5,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          transformResponse: [(value: string) => value],
          validateStatus: (status: number) => status >= 200 && status < 400,
        });

        const html = typeof response.data === 'string'
          ? response.data
          : String(response.data);

        this.logger.log(
          `completed scrape request for ${url} with status ${response.status} and ${html.length} bytes`,
        );

        return html;
      } catch (error: unknown) {
        lastError = error;
        const errorMessage = this.getErrorMessage(error);
        const statusCode = this.getStatusCode(error);
        const shouldRetry =
          attempt < fetchConfig.maxRetryAttempts && this.shouldRetry(error);

        if (shouldRetry) {
          const retryDelayMs = this.getRetryDelayMs(attempt, statusCode);

          this.logger.warn(
            `scrape request failed for ${url} on attempt ${attempt}/${fetchConfig.maxRetryAttempts} (${errorMessage}); retrying in ${retryDelayMs}ms`,
          );

          await this.delay(retryDelayMs);
          continue;
        }

        this.logger.error(
          `scrape request failed for ${url} on attempt ${attempt}/${fetchConfig.maxRetryAttempts}: ${errorMessage}`,
        );
      } finally {
        releaseSlot();
      }
    }

    throw new Error(
      `Failed to fetch HTML for ${url}: ${this.getErrorMessage(lastError)}`,
    );
  }

  private async acquireRequestSlot(): Promise<() => void> {
    while (this.activeRequests >= this.appConfig.fetch.maxConcurrentRequests) {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    this.activeRequests += 1;

    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt =
      Math.max(this.nextRequestAt, Date.now())
      + this.appConfig.fetch.minRequestIntervalMs;

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
    const { userAgents } = this.appConfig.fetch;
    const userAgent = userAgents[this.userAgentIndex % userAgents.length];

    this.userAgentIndex += 1;

    return userAgent;
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
    const baseRetryDelayMs = this.appConfig.fetch.baseRetryDelayMs;

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
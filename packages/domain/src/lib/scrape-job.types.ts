import { readNumberEnv } from './env.utils.js';
import type { JobId, JobStatus } from './job.types.js';

export const DEFAULT_SCRAPE_JOB_QUEUE_NAME = 'scrape-job-queue';
export const DEFAULT_SCRAPE_STATUS_QUEUE_NAME = 'scrape-status-queue';
export const DEFAULT_SCRAPE_JOB_PATTERN = 'scrape.submit';
export const DEFAULT_SCRAPE_JOB_STATUS_PATTERN = 'scrape.status';
export const DEFAULT_MAX_SCRAPE_URL_LENGTH = 2048;
export const SCRAPE_MAX_URL_LENGTH_ENV_VAR = 'SCRAPE_MAX_URL_LENGTH';

const ALLOWED_SCRAPE_URL_PROTOCOLS = new Set(['http:', 'https:']);

export interface ScrapeMessagingConfig {
  jobQueueName: string;
  statusQueueName: string;
  jobPattern: string;
  statusPattern: string;
}

export interface ScrapeValidationConfig {
  maxUrlLength: number;
}

export function readScrapeMessagingConfig(
  env: Record<string, string | undefined>,
): ScrapeMessagingConfig {
  return {
    jobQueueName: env.SCRAPE_JOB_QUEUE_NAME || DEFAULT_SCRAPE_JOB_QUEUE_NAME,
    statusQueueName:
      env.SCRAPE_STATUS_QUEUE_NAME || DEFAULT_SCRAPE_STATUS_QUEUE_NAME,
    jobPattern: env.SCRAPE_JOB_PATTERN || DEFAULT_SCRAPE_JOB_PATTERN,
    statusPattern:
      env.SCRAPE_JOB_STATUS_PATTERN || DEFAULT_SCRAPE_JOB_STATUS_PATTERN,
  };
}

export function readScrapeValidationConfig(
  env: Record<string, string | undefined>,
): ScrapeValidationConfig {
  const maxUrlLength = readNumberEnv(
    env[SCRAPE_MAX_URL_LENGTH_ENV_VAR],
    DEFAULT_MAX_SCRAPE_URL_LENGTH,
  );

  if (!Number.isInteger(maxUrlLength) || maxUrlLength < 1) {
    throw new Error(
      `${SCRAPE_MAX_URL_LENGTH_ENV_VAR} must be a positive integer`,
    );
  }

  return { maxUrlLength };
}

export const MAX_SCRAPE_URL_LENGTH =
  readScrapeValidationConfig(process.env).maxUrlLength;

export interface SubmitScrapeJobPayload {
  url: string;
}

export interface GetScrapeJobPayload {
  jobId: JobId;
}

export interface SubmitScrapeJobAcknowledgement {
  accepted: true;
  jobId: JobId;
  url: string;
  status: JobStatus;
}

export interface ScrapeJobStatusView {
  jobId: JobId;
  url: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  resultPath?: string;
  errorMessage?: string;
}

export type ScrapeJobUpdateStatus = Extract<
  JobStatus,
  'PROCESSING' | 'COMPLETED' | 'FAILED'
>;

export interface ScrapeJobStatusUpdatePayload {
  jobId: JobId;
  status: ScrapeJobUpdateStatus;
  resultPath?: string;
  errorMessage?: string;
}

export type GetScrapeJobResult = ScrapeJobStatusView | null;

export class InvalidScrapeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScrapeUrlError';
  }
}

export function normalizeAndValidateScrapeUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidScrapeUrlError('url must be a string');
  }

  const normalizedUrl = value.trim();

  if (normalizedUrl.length === 0) {
    throw new InvalidScrapeUrlError('url must not be empty');
  }

  if (normalizedUrl.length > MAX_SCRAPE_URL_LENGTH) {
    throw new InvalidScrapeUrlError(
      `url must not exceed ${MAX_SCRAPE_URL_LENGTH} characters`,
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new InvalidScrapeUrlError('url must be a valid absolute URL');
  }

  if (!ALLOWED_SCRAPE_URL_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new InvalidScrapeUrlError('url must use the http or https protocol');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new InvalidScrapeUrlError('url must not include embedded credentials');
  }

  return normalizedUrl;
}
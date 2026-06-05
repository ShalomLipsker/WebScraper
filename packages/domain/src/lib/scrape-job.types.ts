import type { JobId, JobStatus } from './job.types.js';

export const DEFAULT_SCRAPE_JOB_QUEUE_NAME = 'scrape-job-queue';
export const DEFAULT_SCRAPE_STATUS_QUEUE_NAME = 'scrape-status-queue';
export const DEFAULT_SCRAPE_JOB_PATTERN = 'scrape.submit';
export const DEFAULT_SCRAPE_JOB_STATUS_PATTERN = 'scrape.status';

export interface ScrapeMessagingConfig {
  jobQueueName: string;
  statusQueueName: string;
  jobPattern: string;
  statusPattern: string;
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
import type { JobId, JobStatus } from './job.types.js';

export const SCRAPE_JOB_PATTERN = 'scrape.submit';
export const SCRAPE_JOB_STATUS_PATTERN = 'scrape.status';

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

export type GetScrapeJobResult = ScrapeJobStatusView | null;
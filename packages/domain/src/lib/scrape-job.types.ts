export const SCRAPE_JOB_PATTERN = 'scrape.submit';

export interface SubmitScrapeJobPayload {
  url: string;
}

export interface SubmitScrapeJobAcknowledgement {
  accepted: true;
  url: string;
}
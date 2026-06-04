import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SCRAPE_JOB_PATTERN, SCRAPE_JOB_STATUS_PATTERN } from '@org/domain';
import type {
  GetScrapeJobPayload,
  GetScrapeJobResult,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import { ScrapeJobsService } from './scrape-jobs.service';

@Controller()
export class ScrapeJobsController {
  constructor(private readonly scrapeJobsService: ScrapeJobsService) {}

  @MessagePattern(SCRAPE_JOB_PATTERN)
  submitJob(
    @Payload() payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    return this.scrapeJobsService.submitJob(payload);
  }

  @MessagePattern(SCRAPE_JOB_STATUS_PATTERN)
  getJobStatus(
    @Payload() payload: GetScrapeJobPayload,
  ): Promise<GetScrapeJobResult> {
    return this.scrapeJobsService.getJobStatus(payload);
  }
}
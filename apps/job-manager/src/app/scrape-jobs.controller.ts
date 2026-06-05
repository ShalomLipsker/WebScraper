import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  GetScrapeJobPayload,
  GetScrapeJobResult,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import { jobManagerMessagingBindings } from './app.config';
import { ScrapeJobsService } from './scrape-jobs.service';

@Controller()
export class ScrapeJobsController {
  constructor(private readonly scrapeJobsService: ScrapeJobsService) {}

  @MessagePattern(jobManagerMessagingBindings.jobPattern)
  submitJob(
    @Payload() payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    return this.scrapeJobsService.submitJob(payload);
  }

  @MessagePattern(jobManagerMessagingBindings.statusPattern)
  getJobStatus(
    @Payload() payload: GetScrapeJobPayload,
  ): Promise<GetScrapeJobResult> {
    return this.scrapeJobsService.getJobStatus(payload);
  }
}
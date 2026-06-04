import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SCRAPE_JOB_PATTERN } from '@org/domain';
import type {
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';

@Controller()
export class ScrapeJobsController {
  @MessagePattern(SCRAPE_JOB_PATTERN)
  submitJob(
    @Payload() payload: SubmitScrapeJobPayload,
  ): SubmitScrapeJobAcknowledgement {
    return {
      accepted: true,
      url: payload.url,
    };
  }
}
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  GetScrapeJobPayload,
  GetScrapeJobResult,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import { PinoLoggerService } from '@org/logger';
import { withTraceContext } from '@org/tracing';
import { jobManagerMessagingBindings } from './app.config';
import { ScrapeJobsService } from './scrape-jobs.service';

@Controller()
export class ScrapeJobsController {
  constructor(
    private readonly scrapeJobsService: ScrapeJobsService,
    private readonly logger: PinoLoggerService,
  ) {}

  @MessagePattern(jobManagerMessagingBindings.jobPattern)
  async submitJob(
    @Payload() payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    return withTraceContext(payload.traceContext, async () => {
      const result = await this.scrapeJobsService.submitJob(payload);

      this.logger.log({
        event: 'received scrape job submission command',
        correlationId: payload.correlationId,
        jobId: result.jobId,
        status: result.status,
        outcome: 'accepted',
      });

      return result;
    });
  }

  @MessagePattern(jobManagerMessagingBindings.statusPattern)
  async getJobStatus(
    @Payload() payload: GetScrapeJobPayload,
  ): Promise<GetScrapeJobResult> {
    return withTraceContext(payload.traceContext, async () => {
      const result = await this.scrapeJobsService.getJobStatus(payload);

      this.logger.log({
        event: result ? 'loaded scrape job status command' : 'missing scrape job status command',
        correlationId: payload.correlationId,
        jobId: payload.jobId,
        status: result?.status,
        outcome: result ? 'loaded' : 'missing',
      });

      return result;
    });
  }
}
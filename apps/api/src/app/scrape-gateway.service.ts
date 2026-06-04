import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  GetScrapeJobResult,
  SCRAPE_JOB_STATUS_PATTERN,
  SCRAPE_JOB_PATTERN,
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import { firstValueFrom } from 'rxjs';
import { JOB_MANAGER_CLIENT } from './job-manager-client';

@Injectable()
export class ScrapeGatewayService {
  constructor(
    @Inject(JOB_MANAGER_CLIENT)
    private readonly jobManagerClient: ClientProxy,
  ) { }

  submitJob(
    payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    return firstValueFrom(
      this.jobManagerClient.send<SubmitScrapeJobAcknowledgement>(
        SCRAPE_JOB_PATTERN,
        payload,
      ),
    );
  }

  getJobStatus(jobId: string): Promise<GetScrapeJobResult> {
    return firstValueFrom(
      this.jobManagerClient.send<ScrapeJobStatusView | null>(
        SCRAPE_JOB_STATUS_PATTERN,
        { jobId },
      ),
    );
  }
}
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  SCRAPE_JOB_PATTERN,
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
}
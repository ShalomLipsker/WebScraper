import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  GetScrapeJobPayload,
  GetScrapeJobResult,
  IJobRepository,
  JobStatus,
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import {
  InvalidScrapeUrlError,
  normalizeAndValidateScrapeUrl,
} from '@org/domain';
import type { IJobSubmissionStore } from '@org/persistence';
import {
  JOB_REPOSITORY_TOKEN,
  JOB_SUBMISSION_STORE_TOKEN,
} from '@org/persistence';
import { jobManagerMessagingConfig } from './app.config';
import { type ConfigType } from '@nestjs/config';

@Injectable()
export class ScrapeJobsService {
  constructor(
    @Inject(jobManagerMessagingConfig.KEY)
    private readonly messagingConfig: ConfigType<typeof jobManagerMessagingConfig>,
    @Inject(JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: IJobRepository,
    @Inject(JOB_SUBMISSION_STORE_TOKEN)
    private readonly jobSubmissionStore: IJobSubmissionStore,
  ) {}

  async submitJob(
    payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    const url = this.normalizeSubmittedUrl(payload.url);
    const jobId = hashUrl(url);
    const status: JobStatus = 'SUBMITTED';

    const { job, alreadyExisted } = await this.jobSubmissionStore.createJobSubmissionIfNotExists(
      {
        job: {
          id: jobId,
          url,
          status,
        },
        queueName: this.messagingConfig.jobQueueName,
        message: {
          id: jobId,
          name: this.messagingConfig.jobPattern,
          data: { url },
        },
      },
    );

    return createAcknowledgement(
      job.id,
      job.url,
      alreadyExisted ? job.status : 'SUBMITTED',
    );
  }

  async getJobStatus(
    payload: GetScrapeJobPayload,
  ): Promise<GetScrapeJobResult> {
    const job = await this.jobRepository.getJob(payload.jobId);

    if (!job) {
      return null;
    }

    return createStatusView(job);
  }

  private normalizeSubmittedUrl(url: unknown): string {
    try {
      return normalizeAndValidateScrapeUrl(url);
    } catch (error: unknown) {
      if (error instanceof InvalidScrapeUrlError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }
}

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function createAcknowledgement(
  jobId: string,
  url: string,
  status: JobStatus,
): SubmitScrapeJobAcknowledgement {
  return {
    accepted: true,
    jobId,
    url,
    status,
  };
}

function createStatusView(job: {
  id: string;
  url: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  resultPath?: string;
  errorMessage?: string;
}): ScrapeJobStatusView {
  return {
    jobId: job.id,
    url: job.url,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    resultPath: job.resultPath,
    errorMessage: job.errorMessage,
  };
}
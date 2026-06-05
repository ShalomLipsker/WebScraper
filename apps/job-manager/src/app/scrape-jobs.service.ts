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
import { PinoLoggerService } from '@org/logger';
import {
  InvalidScrapeProxyError,
  InvalidScrapeUrlError,
  normalizeAndValidateScrapeProxy,
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
    private readonly logger: PinoLoggerService,
  ) {}

  async submitJob(
    payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    const url = this.normalizeSubmittedUrl(payload.url);
    const proxy = this.normalizeSubmittedProxy(payload.proxy);
    const jobId = hashJobRequest(url, proxy);
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
          data: {
            url,
            correlationId: payload.correlationId,
            ...(proxy ? { proxy } : {}),
          },
        },
      },
    );

    this.logger.log({
      event: alreadyExisted ? 'reused scrape job submission' : 'created scrape job submission',
      correlationId: payload.correlationId,
      jobId: job.id,
      sourceUrl: job.url,
      status: job.status,
      usedProxy: Boolean(proxy),
      outcome: alreadyExisted ? 'already_exists' : 'created',
    });

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

    this.logger.log({
      event: job ? 'loaded scrape job status' : 'missing scrape job status',
      correlationId: payload.correlationId,
      jobId: payload.jobId,
      status: job?.status,
      outcome: job ? 'loaded' : 'missing',
    });

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

  private normalizeSubmittedProxy(proxy: unknown): string | undefined {
    if (proxy === undefined) {
      return undefined;
    }

    try {
      return normalizeAndValidateScrapeProxy(proxy);
    } catch (error: unknown) {
      if (error instanceof InvalidScrapeProxyError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }
}

function hashJobRequest(url: string, proxy?: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ url, proxy: proxy ?? null }))
    .digest('hex');
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
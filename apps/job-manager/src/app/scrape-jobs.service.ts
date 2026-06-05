import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GetScrapeJobPayload,
  GetScrapeJobResult,
  IJobRepository,
  JobStatus,
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import type { IMessageQueue } from '@org/messaging';
import { MESSAGE_QUEUE_TOKEN } from '@org/messaging';
import { JOB_REPOSITORY_TOKEN } from '@org/persistence';
import { getAppConfig, type JobManagerAppConfig } from './app.config';

@Injectable()
export class ScrapeJobsService {
  private readonly appConfig: JobManagerAppConfig;

  constructor(
    private readonly configService: ConfigService,
    @Inject(JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: IJobRepository,
    @Inject(MESSAGE_QUEUE_TOKEN)
    private readonly messageQueue: IMessageQueue,
  ) {
    this.appConfig = getAppConfig(this.configService);
  }

  async submitJob(
    payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    const url = payload.url.trim();
    const jobId = hashUrl(url);
    const status: JobStatus = 'SUBMITTED';

    const { job, alreadyExisted } = await this.jobRepository.createJobIfNotExists({
      id: jobId,
      url,
      status,
    });

    if (alreadyExisted) {
      return createAcknowledgement(job.id, job.url, job.status);
    }

    await this.messageQueue.publish(
      {
        id: jobId,
        name: this.appConfig.messaging.jobPattern,
        data: { url },
      },
    );

    await this.jobRepository.updateJobStatus(jobId, 'ENQUEUED');

    return createAcknowledgement(jobId, url, 'ENQUEUED');
  }

  async getJobStatus(
    payload: GetScrapeJobPayload,
  ): Promise<GetScrapeJobResult> {
    const job = await this.jobRepository.getJob(payload.jobId);

    if (!job) {
      return null;
    }

    const resolvedJob = await this.recoverSubmittedJobIfStale(job.id) ?? job;

    return createStatusView(resolvedJob);
  }

  private async recoverSubmittedJobIfStale(
    jobId: string,
  ) {
    const job = await this.jobRepository.getJob(jobId);

    if (!job || job.status !== 'SUBMITTED') {
      return job;
    }

    if (
      Date.now() - job.updatedAt.getTime()
      < this.appConfig.recovery.submittedDelayMs
    ) {
      return job;
    }

    try {
      const queueState = await this.messageQueue.getJobState(job.id);

      if (queueState !== 'missing') {
        await this.jobRepository.updateJobStatus(job.id, 'ENQUEUED');
        return await this.jobRepository.getJob(job.id);
      }

      const acquiredLease = await this.jobRepository.tryAcquireRecoveryLease(
        job.id,
        this.appConfig.recovery.submittedLeaseSeconds,
      );

      if (!acquiredLease) {
        return job;
      }

      const refreshedQueueState = await this.messageQueue.getJobState(job.id);

      if (refreshedQueueState === 'missing') {
        await this.messageQueue.publish(
          {
            id: job.id,
            name: this.appConfig.messaging.jobPattern,
            data: { url: job.url },
          },
        );
      }

      await this.jobRepository.updateJobStatus(job.id, 'ENQUEUED');

      return await this.jobRepository.getJob(job.id);
    } catch {
      return job;
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
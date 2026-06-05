import {
  ConflictException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import type { Readable } from 'node:stream';
import {
  GetScrapeJobResult,
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import {
  resolveStorageLocation,
  S3StorageService,
  StorageObjectMissingError,
  StorageServiceError,
} from '@org/storage';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { apiJobManagerConfig, apiMessagingConfig, apiStorageConfig } from './app.config';
import { JOB_MANAGER_CLIENT } from './job-manager-client';

export interface CompletedScrapeJobAccessView extends ScrapeJobStatusView {
  deliveryMode: 'presigned-url';
  presignedUrl: string;
  expiresAt: string;
}

export interface CompletedScrapeJobStream {
  contentType?: string;
  contentLength?: number;
  body: Readable;
}

export type CompletedScrapeJobDeliveryMode = 'status' | 'stream' | 'presigned-url';

@Injectable()
export class ScrapeGatewayService {
  constructor(
    @Inject(apiJobManagerConfig.KEY)
    private readonly jobManagerConfig: ConfigType<typeof apiJobManagerConfig>,
    @Inject(apiMessagingConfig.KEY)
    private readonly messagingConfig: ConfigType<typeof apiMessagingConfig>,
    @Inject(apiStorageConfig.KEY)
    private readonly storageConfig: ConfigType<typeof apiStorageConfig>,
    @Inject(JOB_MANAGER_CLIENT)
    private readonly jobManagerClient: ClientProxy,
    private readonly storageService: S3StorageService,
  ) {}

  submitJob(
    payload: SubmitScrapeJobPayload,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    return this.sendToJobManager<SubmitScrapeJobAcknowledgement>(
      this.messagingConfig.jobPattern,
      payload,
    );
  }

  getJobStatus(jobId: string): Promise<GetScrapeJobResult> {
    return this.sendToJobManager<ScrapeJobStatusView | null>(
      this.messagingConfig.statusPattern,
      { jobId },
    );
  }

  async getCompletedJobStream(
    job: ScrapeJobStatusView,
  ): Promise<CompletedScrapeJobStream> {
    const location = resolveStorageLocation(
      job.resultPath,
      this.storageConfig.defaultBucket,
    );
    const object = await this.readStoredResult(location.bucket, location.key, () => this.storageService.getObject(location));

    return {
      contentType: object.contentType,
      contentLength: object.contentLength,
      body: object.body,
    };
  }

  async getCompletedJobPresignedUrl(
    job: ScrapeJobStatusView,
  ): Promise<CompletedScrapeJobAccessView> {
    const location = resolveStorageLocation(
      job.resultPath,
      this.storageConfig.defaultBucket,
    );
    await this.readStoredResult(
      location.bucket,
      location.key,
      () => this.storageService.assertObjectExists(location),
    );
    const presignedObject = await this.storageService.createPresignedGetUrl({
      ...location,
      expiresInSeconds: this.storageConfig.presignTtlSeconds,
      responseContentDisposition: `inline; filename="${job.jobId}.html"`,
      responseContentType: 'text/html; charset=utf-8',
    });

    return {
      ...job,
      deliveryMode: 'presigned-url',
      presignedUrl: presignedObject.url,
      expiresAt: presignedObject.expiresAt,
    };
  }

  private sendToJobManager<TResult>(pattern: string, payload: unknown): Promise<TResult> {
    return firstValueFrom(
      this.jobManagerClient.send<TResult>(pattern, payload).pipe(
        timeout(this.jobManagerConfig.requestTimeoutMs),
        catchError((error: unknown) => throwError(() => this.mapJobManagerError(error))),
      ),
    );
  }

  private async readStoredResult<TResult>(
    bucket: string | undefined,
    key: string,
    read: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await read();
    } catch (error) {
      throw this.mapStorageError(error, bucket, key);
    }
  }

  private mapJobManagerError(error: unknown): Error {
    if (isTimeoutError(error)) {
      return new GatewayTimeoutException(
        `Job manager did not respond within ${this.jobManagerConfig.requestTimeoutMs}ms`,
      );
    }

    return new ServiceUnavailableException('Job manager is unavailable');
  }

  private mapStorageError(
    error: unknown,
    bucket: string | undefined,
    key: string,
  ): Error {
    if (error instanceof StorageObjectMissingError) {
      return new ConflictException(
        `Completed job result is unavailable because storage object ${error.bucket}/${error.key} is missing`,
      );
    }

    if (error instanceof StorageServiceError) {
      return new ServiceUnavailableException(
        `Storage is unavailable while accessing completed job result ${error.bucket}/${error.key}`,
      );
    }

    return new ServiceUnavailableException(
      `Storage is unavailable while accessing completed job result ${(bucket ?? '<default>')}/${key}`,
    );
  }
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && error.name === 'TimeoutError',
  );
}
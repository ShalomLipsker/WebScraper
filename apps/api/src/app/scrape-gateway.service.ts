import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import type { Readable } from 'node:stream';
import {
  GetScrapeJobResult,
  SCRAPE_JOB_STATUS_PATTERN,
  SCRAPE_JOB_PATTERN,
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
  SubmitScrapeJobPayload,
} from '@org/domain';
import { S3StorageService } from '@org/storage';
import { firstValueFrom } from 'rxjs';
import { getAppConfig, type ApiConfig } from './app.config';
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
  private readonly appConfig: ApiConfig;

  constructor(
    private readonly configService: ConfigService,
    @Inject(JOB_MANAGER_CLIENT)
    private readonly jobManagerClient: ClientProxy,
    private readonly storageService: S3StorageService,
  ) {
    this.appConfig = getAppConfig(this.configService);
  }

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

  async getCompletedJobStream(
    job: ScrapeJobStatusView,
  ): Promise<CompletedScrapeJobStream> {
    const location = resolveStorageLocation(
      job.resultPath,
      this.appConfig.storage.defaultBucket,
    );
    const object = await this.storageService.getObject(location);

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
      this.appConfig.storage.defaultBucket,
    );
    const presignedObject = await this.storageService.createPresignedGetUrl({
      ...location,
      expiresInSeconds: this.appConfig.storage.presignTtlSeconds,
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
}

function resolveStorageLocation(
  filePath: string | undefined,
  defaultBucket: string | undefined,
): { bucket?: string; key: string } {
  if (!filePath) {
    throw new Error('Completed job is missing its storage path.');
  }

  if (filePath.startsWith('s3://')) {
    const [, bucketAndKey = ''] = filePath.split('s3://');
    const separatorIndex = bucketAndKey.indexOf('/');

    if (separatorIndex <= 0 || separatorIndex === bucketAndKey.length - 1) {
      throw new Error(`Invalid storage path: ${filePath}`);
    }

    return {
      bucket: bucketAndKey.slice(0, separatorIndex),
      key: bucketAndKey.slice(separatorIndex + 1),
    };
  }

  const separatorIndex = filePath.indexOf('/');

  if (separatorIndex > 0 && separatorIndex < filePath.length - 1) {
    return {
      bucket: filePath.slice(0, separatorIndex),
      key: filePath.slice(separatorIndex + 1),
    };
  }

  return {
    bucket: defaultBucket,
    key: filePath,
  };
}
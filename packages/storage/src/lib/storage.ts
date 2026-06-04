import { Inject, Injectable } from '@nestjs/common';
import {
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';

import {
  S3_STORAGE_CLIENT_TOKEN,
  S3_STORAGE_OPTIONS_TOKEN,
} from './storage.constants.js';
import type {
  PutStorageObjectInput,
  PutStorageTextInput,
  ResolvedS3StorageModuleOptions,
  StoredObjectReference,
} from './storage.types.js';

@Injectable()
export class S3StorageService {
  constructor(
    @Inject(S3_STORAGE_CLIENT_TOKEN)
    private readonly s3Client: S3Client,
    @Inject(S3_STORAGE_OPTIONS_TOKEN)
    private readonly options: ResolvedS3StorageModuleOptions,
  ) {}

  async putObject(
    input: PutStorageObjectInput,
  ): Promise<StoredObjectReference> {
    const bucket = input.bucket ?? this.options.defaultBucket;

    if (!bucket) {
      throw new Error(
        'S3 bucket is required. Pass input.bucket or configure defaultBucket.',
      );
    }

    const command = new PutObjectCommand(this.createPutObjectInput(input, bucket));
    const response = await this.s3Client.send(command);

    return {
      bucket,
      key: input.key,
      eTag: response.ETag,
      versionId: response.VersionId,
    };
  }

  putText(input: PutStorageTextInput): Promise<StoredObjectReference> {
    return this.putObject({
      ...input,
      body: input.body,
      contentType: input.contentType ?? 'text/plain; charset=utf-8',
    });
  }

  putBuffer(
    input: Omit<PutStorageObjectInput, 'body'> & { body: Buffer },
  ): Promise<StoredObjectReference> {
    return this.putObject(input);
  }

  private createPutObjectInput(
    input: PutStorageObjectInput,
    bucket: string,
  ): PutObjectCommandInput {
    return {
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      ContentDisposition: input.contentDisposition,
      ContentEncoding: input.contentEncoding,
      Metadata: input.metadata,
    };
  }
}

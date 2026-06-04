import { Inject, Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  type GetObjectCommandInput,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

import {
  S3_STORAGE_CLIENT_TOKEN,
  S3_STORAGE_OPTIONS_TOKEN,
} from './storage.constants.js';
import type {
  PresignedStorageObjectUrl,
  PresignStorageObjectInput,
  PutStorageObjectInput,
  PutStorageTextInput,
  RetrievedStorageObject,
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

  async getObject(
    input: { bucket?: string; key: string },
  ): Promise<RetrievedStorageObject> {
    const bucket = this.resolveBucket(input.bucket);
    const command = new GetObjectCommand(this.createGetObjectInput(input, bucket));
    const response = await this.s3Client.send(command);

    return {
      bucket,
      key: input.key,
      body: toReadableStream(response.Body, bucket, input.key),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      eTag: response.ETag,
    };
  }

  async createPresignedGetUrl(
    input: PresignStorageObjectInput,
  ): Promise<PresignedStorageObjectUrl> {
    const bucket = this.resolveBucket(input.bucket);
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    const command = new GetObjectCommand(
      this.createGetObjectInput(
        {
          key: input.key,
          responseContentType: input.responseContentType,
          responseContentDisposition: input.responseContentDisposition,
        },
        bucket,
      ),
    );
    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      bucket,
      key: input.key,
      url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
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

  private createGetObjectInput(
    input: {
      key: string;
      responseContentDisposition?: string;
      responseContentType?: string;
    },
    bucket: string,
  ): GetObjectCommandInput {
    return {
      Bucket: bucket,
      Key: input.key,
      ResponseContentDisposition: input.responseContentDisposition,
      ResponseContentType: input.responseContentType,
    };
  }

  private resolveBucket(bucket?: string): string {
    const resolvedBucket = bucket ?? this.options.defaultBucket;

    if (!resolvedBucket) {
      throw new Error(
        'S3 bucket is required. Pass input.bucket or configure defaultBucket.',
      );
    }

    return resolvedBucket;
  }
}

function toReadableStream(
  body: unknown,
  bucket: string,
  key: string,
): Readable {
  if (body instanceof Readable) {
    return body;
  }

  if (body && typeof body === 'object' && 'pipe' in body) {
    return body as Readable;
  }

  throw new Error(
    `Storage object ${bucket}/${key} did not return a readable body stream.`,
  );
}

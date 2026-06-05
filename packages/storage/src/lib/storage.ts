import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
  DeleteStorageObjectInput,
  PresignStorageObjectInput,
  PutStorageObjectInput,
  PutStorageTextInput,
  RetrievedStorageObject,
  ResolvedS3StorageModuleOptions,
  StorageObjectLocation,
  StoredObjectReference,
} from './storage.types.js';

export function resolveStorageLocation(
  filePath: string | undefined,
  defaultBucket: string | undefined,
): StorageObjectLocation {
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

  if (defaultBucket) {
    return {
      bucket: defaultBucket,
      key: filePath,
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
    key: filePath,
  };
}

export class StorageObjectMissingError extends Error {
  constructor(
    readonly bucket: string,
    readonly key: string,
  ) {
    super(`Storage object ${bucket}/${key} was not found.`);
    this.name = 'StorageObjectMissingError';
  }
}

export class StorageServiceError extends Error {
  constructor(
    readonly bucket: string,
    readonly key: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StorageServiceError';
  }
}

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
    let response;

    try {
      response = await this.s3Client.send(command);
    } catch (error) {
      throw classifyStorageError(error, bucket, input.key);
    }

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

  async assertObjectExists(input: { bucket?: string; key: string }): Promise<void> {
    const bucket = this.resolveBucket(input.bucket);

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
        Bucket: bucket,
        Key: input.key,
        }),
      );
    } catch (error) {
      throw classifyStorageError(error, bucket, input.key);
    }
  }

  async deleteObject(input: DeleteStorageObjectInput): Promise<void> {
    const bucket = this.resolveBucket(input.bucket);

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: input.key,
      }),
    );
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

function classifyStorageError(
  error: unknown,
  bucket: string,
  key: string,
): Error {
  const name = readErrorString(error, 'name');
  const code = readErrorString(error, 'Code') ?? readErrorString(error, 'code');
  const statusCode = readErrorStatusCode(error);

  if (
    name === 'NoSuchKey'
    || name === 'NotFound'
    || code === 'NoSuchKey'
    || code === 'NotFound'
    || statusCode === 404
  ) {
    return new StorageObjectMissingError(bucket, key);
  }

  return new StorageServiceError(
    bucket,
    key,
    `Storage request for ${bucket}/${key} failed.`,
    { cause: error },
  );
}

function readErrorString(
  value: unknown,
  property: 'name' | 'Code' | 'code',
): string | undefined {
  if (!value || typeof value !== 'object' || !(property in value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[property];

  return typeof candidate === 'string' ? candidate : undefined;
}

function readErrorStatusCode(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || !('$metadata' in value)) {
    return undefined;
  }

  const metadata = value.$metadata;

  if (!metadata || typeof metadata !== 'object' || !('httpStatusCode' in metadata)) {
    return undefined;
  }

  const statusCode = metadata.httpStatusCode;

  return typeof statusCode === 'number' ? statusCode : undefined;
}

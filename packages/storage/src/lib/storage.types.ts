import type { S3ClientConfig } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export interface StoredObjectReference {
  bucket: string;
  key: string;
  eTag?: string;
  versionId?: string;
}

export interface StorageObjectLocation {
  bucket?: string;
  key: string;
}

export interface DeleteStorageObjectInput extends StorageObjectLocation {}

export interface RetrievedStorageObject extends StoredObjectReference {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
}

export interface PresignStorageObjectInput extends StorageObjectLocation {
  expiresInSeconds?: number;
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface PresignedStorageObjectUrl extends StoredObjectReference {
  url: string;
  expiresAt: string;
}

export interface StorageObjectRequestBase {
  bucket?: string;
  key: string;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  metadata?: Record<string, string>;
}

export interface PutStorageObjectInput extends StorageObjectRequestBase {
  body: string | Buffer | Uint8Array;
}

export interface PutStorageTextInput
  extends Omit<PutStorageObjectInput, 'body'> {
  body: string;
}

export interface S3StorageModuleOptions {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: S3ClientConfig['credentials'];
  defaultBucket?: string;
}

export interface ResolvedS3StorageModuleOptions {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: S3ClientConfig['credentials'];
  defaultBucket?: string;
}
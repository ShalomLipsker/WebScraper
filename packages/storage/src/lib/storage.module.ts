import { Module, type DynamicModule } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';

import {
  DEFAULT_FORCE_PATH_STYLE,
  DEFAULT_S3_REGION,
  S3_STORAGE_CLIENT_TOKEN,
  S3_STORAGE_OPTIONS_TOKEN,
} from './storage.constants.js';
import { S3StorageService } from './storage.js';
import type {
  ResolvedS3StorageModuleOptions,
  S3StorageModuleOptions,
} from './storage.types.js';

@Module({})
export class StorageModule {
  static register(options: S3StorageModuleOptions): DynamicModule {
    const resolvedOptions = resolveS3StorageModuleOptions(options);

    return {
      module: StorageModule,
      providers: [
        {
          provide: S3_STORAGE_OPTIONS_TOKEN,
          useValue: resolvedOptions,
        },
        {
          provide: S3_STORAGE_CLIENT_TOKEN,
          useFactory: () => new S3Client(createS3ClientConfig(resolvedOptions)),
        },
        S3StorageService,
      ],
      exports: [S3_STORAGE_CLIENT_TOKEN, S3_STORAGE_OPTIONS_TOKEN, S3StorageService],
    };
  }
}

export function resolveS3StorageModuleOptions(
  options: S3StorageModuleOptions,
): ResolvedS3StorageModuleOptions {
  return {
    region: options.region ?? DEFAULT_S3_REGION,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? DEFAULT_FORCE_PATH_STYLE,
    credentials: options.credentials,
    defaultBucket: options.defaultBucket,
  };
}

function createS3ClientConfig(options: ResolvedS3StorageModuleOptions) {
  return {
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: options.credentials,
  };
}
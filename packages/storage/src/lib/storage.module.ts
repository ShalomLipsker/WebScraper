import { Module, type DynamicModule, type Type } from '@nestjs/common';
import type {
  FactoryProvider,
  InjectionToken,
  OptionalFactoryDependency,
} from '@nestjs/common';
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
  static registerAsync(options: StorageModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider<ResolvedS3StorageModuleOptions> = {
      provide: S3_STORAGE_OPTIONS_TOKEN,
      useFactory: async (...args: unknown[]) => resolveS3StorageModuleOptions(
        await options.useFactory(...args),
      ),
      inject: options.inject ?? [],
    };

    return {
      module: StorageModule,
      imports: options.imports,
      providers: [
        optionsProvider,
        {
          provide: S3_STORAGE_CLIENT_TOKEN,
          useFactory: (resolvedOptions: ResolvedS3StorageModuleOptions) => new S3Client(
            createS3ClientConfig(resolvedOptions),
          ),
          inject: [S3_STORAGE_OPTIONS_TOKEN],
        },
        S3StorageService,
      ],
      exports: [S3_STORAGE_CLIENT_TOKEN, S3_STORAGE_OPTIONS_TOKEN, S3StorageService],
    };
  }
}

export interface StorageModuleAsyncOptions {
  imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule>>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: unknown[]) =>
    | S3StorageModuleOptions
    | Promise<S3StorageModuleOptions>;
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
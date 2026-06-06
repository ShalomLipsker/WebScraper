import {
  Module,
  type DynamicModule,
  type FactoryProvider,
  type InjectionToken,
  type OptionalFactoryDependency,
  type Type,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  DEFAULT_JOB_RETENTION_SECONDS,
  JOB_REPOSITORY_TOKEN,
  JOB_SUBMISSION_STORE_TOKEN,
  OUTBOX_MESSAGE_STORE_TOKEN,
  POSTGRES_PERSISTENCE_OPTIONS_TOKEN,
} from './persistence.constants.js';
import {
  JobEntity,
  OutboxMessageEntity,
} from './persistence.entities.js';
import { PostgresAdvisoryLockRunner } from './postgres-advisory-lock.js';
import { PostgresJobRepository } from './postgres-job-repository.js';
import { PostgresJobSubmissionStore } from './postgres-job-submission-store.js';
import { PostgresOutboxService } from './postgres-outbox.service.js';
import type { PostgresPersistenceModuleOptions } from './persistence.types.js';

@Module({})
export class PersistenceModule {
  static registerAsync(options: PersistenceModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider<PostgresPersistenceModuleOptions> = {
      provide: POSTGRES_PERSISTENCE_OPTIONS_TOKEN,
      useFactory: async (...args: unknown[]) => resolvePersistenceModuleOptions(
        await options.useFactory(...args),
      ),
      inject: options.inject ?? [],
    };

    return {
      module: PersistenceModule,
      imports: [
        ...(options.imports ?? []),
        TypeOrmModule.forRootAsync({
          imports: options.imports,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) => {
            const resolvedOptions = resolvePersistenceModuleOptions(
              await options.useFactory(...args),
            );

            return {
              type: 'postgres' as const,
              url: resolvedOptions.url,
              schema: resolvedOptions.schema,
              logging: resolvedOptions.logging ?? false,
              synchronize: resolvedOptions.synchronize ?? false,
              autoLoadEntities: false,
              entities: [JobEntity, OutboxMessageEntity],
            };
          },
        }),
        TypeOrmModule.forFeature([JobEntity, OutboxMessageEntity]),
      ],
      providers: [
        optionsProvider,
        PostgresAdvisoryLockRunner,
        PostgresJobRepository,
        PostgresJobSubmissionStore,
        PostgresOutboxService,
        {
          provide: JOB_REPOSITORY_TOKEN,
          useExisting: PostgresJobRepository,
        },
        {
          provide: JOB_SUBMISSION_STORE_TOKEN,
          useExisting: PostgresJobSubmissionStore,
        },
        {
          provide: OUTBOX_MESSAGE_STORE_TOKEN,
          useExisting: PostgresOutboxService,
        },
      ],
      exports: [
        JOB_REPOSITORY_TOKEN,
        JOB_SUBMISSION_STORE_TOKEN,
        OUTBOX_MESSAGE_STORE_TOKEN,
        PostgresAdvisoryLockRunner,
        PostgresJobRepository,
        PostgresJobSubmissionStore,
        PostgresOutboxService,
      ],
    };
  }
}

export interface PersistenceModuleAsyncOptions {
  imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule>>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: unknown[]) =>
    | PostgresPersistenceModuleOptions
    | Promise<PostgresPersistenceModuleOptions>;
}

function resolvePersistenceModuleOptions(
  options: PostgresPersistenceModuleOptions,
): PostgresPersistenceModuleOptions {
  return {
    jobRetentionSeconds: DEFAULT_JOB_RETENTION_SECONDS,
    synchronize: true,
    ...options,
  };
}
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import {
  MessagingModule,
  RabbitMqMessageQueue,
  resolveRabbitMqMessagingOptions,
} from '@org/messaging';
import { PersistenceModule } from '@org/persistence';
import { PinoLoggerService, StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import {
  jobManagerConfigModule,
  jobManagerMessagingConfig,
  jobManagerPersistenceConfig,
  jobManagerRabbitMqConfig,
  jobManagerStorageConfig,
} from './app.config';
import { ExpiredJobsCleanupService } from './expired-jobs-cleanup.service';
import { ScrapeJobsController } from './scrape-jobs.controller';
import { SCRAPE_STATUS_QUEUE_TOKEN } from './scrape.constants';
import { ScrapeJobSubmissionOutboxService } from './scrape-job-submission-outbox.service';
import { ScrapeJobStatusUpdatesService } from './scrape-job-status-updates.service';
import { ScrapeJobsService } from './scrape-jobs.service';

@Module({
  imports: [
    jobManagerConfigModule,
    ScheduleModule.forRoot(),
    PersistenceModule.registerAsync({
      imports: [jobManagerConfigModule],
      inject: [jobManagerPersistenceConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [persistenceConfig] = args as [
          ConfigType<typeof jobManagerPersistenceConfig>,
        ];

        return {
          url: persistenceConfig.url,
          synchronize: persistenceConfig.synchronize,
          jobRetentionSeconds: persistenceConfig.jobRetentionSeconds,
        };
      },
    }),
    MessagingModule.registerAsync({
      imports: [jobManagerConfigModule],
      inject: [jobManagerMessagingConfig.KEY, jobManagerRabbitMqConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [messagingConfig, rabbitMqConfig] = args as [
          ConfigType<typeof jobManagerMessagingConfig>,
          ConfigType<typeof jobManagerRabbitMqConfig>,
        ];

        return {
          url: rabbitMqConfig.url,
          queueName: messagingConfig.jobQueueName,
          defaultJobName: messagingConfig.jobPattern,
          queueDeduplication: {
            enabled: rabbitMqConfig.jobQueueDeduplicationEnabled,
          },
        };
      },
    }),
    StorageModule.registerAsync({
      imports: [jobManagerConfigModule],
      inject: [jobManagerStorageConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [storageConfig] = args as [
          ConfigType<typeof jobManagerStorageConfig>,
        ];

        return {
          region: storageConfig.region,
          endpoint: storageConfig.endpoint,
          forcePathStyle: storageConfig.forcePathStyle,
          credentials:
            storageConfig.accessKeyId && storageConfig.secretAccessKey
              ? {
                accessKeyId: storageConfig.accessKeyId,
                secretAccessKey: storageConfig.secretAccessKey,
              }
              : undefined,
          defaultBucket: storageConfig.defaultBucket,
        };
      },
    }),
    StructuredLoggerModule.register({ serviceName: 'job-manager' }),
  ],
  controllers: [ScrapeJobsController],
  providers: [
    {
      provide: SCRAPE_STATUS_QUEUE_TOKEN,
      useFactory: (...args: unknown[]) => {
        const [messagingConfig, rabbitMqConfig, logger] = args as [
          ConfigType<typeof jobManagerMessagingConfig>,
          ConfigType<typeof jobManagerRabbitMqConfig>,
          PinoLoggerService,
        ];

        return new RabbitMqMessageQueue(
          resolveRabbitMqMessagingOptions({
            url: rabbitMqConfig.url,
            queueName: messagingConfig.statusQueueName,
            defaultJobName: messagingConfig.statusPattern,
          }),
          logger,
        );
      },
      inject: [jobManagerMessagingConfig.KEY, jobManagerRabbitMqConfig.KEY, PinoLoggerService],
    },
    ScrapeJobsService,
    ScrapeJobSubmissionOutboxService,
    ScrapeJobStatusUpdatesService,
    ExpiredJobsCleanupService,
  ],
})
export class AppModule { }

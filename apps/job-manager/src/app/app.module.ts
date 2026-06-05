import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import {
  BullMqMessageQueue,
  MessagingModule,
  resolveBullMqMessagingOptions,
} from '@org/messaging';
import { PersistenceModule } from '@org/persistence';
import { StructuredLoggerModule } from '@org/logger';
import {
  jobManagerConfigModule,
  jobManagerMessagingConfig,
} from './app.config';
import { ScrapeJobsController } from './scrape-jobs.controller';
import { ScrapeJobStatusUpdatesService } from './scrape-job-status-updates.service';
import { ScrapeJobsService } from './scrape-jobs.service';

export const SCRAPE_STATUS_QUEUE_TOKEN = Symbol('SCRAPE_STATUS_QUEUE_TOKEN');

@Module({
  imports: [
    jobManagerConfigModule,
    PersistenceModule.register(),
    MessagingModule.registerAsync({
      imports: [jobManagerConfigModule],
      inject: [jobManagerMessagingConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [messagingConfig] = args as [
          ConfigType<typeof jobManagerMessagingConfig>,
        ];

        return {
          queueName: messagingConfig.jobQueueName,
          defaultJobName: messagingConfig.jobPattern,
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
        const [messagingConfig] = args as [
          ConfigType<typeof jobManagerMessagingConfig>,
        ];

        return new BullMqMessageQueue(
          resolveBullMqMessagingOptions({
            queueName: messagingConfig.statusQueueName,
            defaultJobName: messagingConfig.statusPattern,
          }),
        );
      },
      inject: [jobManagerMessagingConfig.KEY],
    },
    ScrapeJobsService,
    ScrapeJobStatusUpdatesService,
  ],
})
export class AppModule {}

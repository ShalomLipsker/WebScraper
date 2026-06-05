import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BullMqMessageQueue,
  MessagingModule,
  resolveBullMqMessagingOptions,
} from '@org/messaging';
import { PersistenceModule } from '@org/persistence';
import { StructuredLoggerModule } from '@org/logger';
import {
  getAppConfig,
  jobManagerConfigModule,
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
      inject: [ConfigService],
      useFactory: (...args: unknown[]) => {
        const [configService] = args as [ConfigService];
        const appConfig = getAppConfig(configService);

        return {
          queueName: appConfig.messaging.jobQueueName,
          defaultJobName: appConfig.messaging.jobPattern,
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
        const [configService] = args as [ConfigService];
        const appConfig = getAppConfig(configService);

        return new BullMqMessageQueue(
        resolveBullMqMessagingOptions({
            queueName: appConfig.messaging.statusQueueName,
            defaultJobName: appConfig.messaging.statusPattern,
        }),
        );
      },
      inject: [ConfigService],
    },
    ScrapeJobsService,
    ScrapeJobStatusUpdatesService,
  ],
})
export class AppModule {}

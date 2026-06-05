import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import {
  BullMqMessageQueue,
  MessagingModule,
  resolveBullMqMessagingOptions,
  resolveRedisConnection,
} from '@org/messaging';
import { PersistenceModule } from '@org/persistence';
import { StructuredLoggerModule } from '@org/logger';
import {
  jobManagerConfigModule,
  jobManagerMessagingConfig,
  jobManagerRedisConfig,
} from './app.config';
import { ScrapeJobsController } from './scrape-jobs.controller';
import { SCRAPE_STATUS_QUEUE_TOKEN } from './scrape.constants';
import { ScrapeJobStatusUpdatesService } from './scrape-job-status-updates.service';
import { ScrapeJobsService } from './scrape-jobs.service';

@Module({
  imports: [
    jobManagerConfigModule,
    PersistenceModule.register({
      url: process.env.REDIS_URL || undefined,
    }),
    MessagingModule.registerAsync({
      imports: [jobManagerConfigModule],
      inject: [jobManagerMessagingConfig.KEY, jobManagerRedisConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [messagingConfig, redisConfig] = args as [
          ConfigType<typeof jobManagerMessagingConfig>,
          ConfigType<typeof jobManagerRedisConfig>,
        ];

        return {
          queueName: messagingConfig.jobQueueName,
          defaultJobName: messagingConfig.jobPattern,
          connection: resolveRedisConnection(redisConfig.url),
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
        const [messagingConfig, redisConfig] = args as [
          ConfigType<typeof jobManagerMessagingConfig>,
          ConfigType<typeof jobManagerRedisConfig>,
        ];

        return new BullMqMessageQueue(
          resolveBullMqMessagingOptions({
            queueName: messagingConfig.statusQueueName,
            defaultJobName: messagingConfig.statusPattern,
            connection: resolveRedisConnection(redisConfig.url),
          }),
        );
      },
      inject: [jobManagerMessagingConfig.KEY, jobManagerRedisConfig.KEY],
    },
    ScrapeJobsService,
    ScrapeJobStatusUpdatesService,
  ],
})
export class AppModule { }

import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import {
  BullMqMessageQueue,
  MessagingModule,
  resolveBullMqMessagingOptions,
} from '@org/messaging';
import { StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import {
  scraperMessagingConfig,
  scraperConfigModule,
  scraperStorageConfig,
} from './app.config';
import { ScrapeEngineService } from './scrape-engine.service';
import { ScrapeWorkerService } from './scrape-worker.service';

export const SCRAPE_STATUS_QUEUE_TOKEN = Symbol('SCRAPE_STATUS_QUEUE_TOKEN');

@Module({
  imports: [
    scraperConfigModule,
    MessagingModule.registerAsync({
      imports: [scraperConfigModule],
      inject: [scraperMessagingConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [messagingConfig] = args as [
          ConfigType<typeof scraperMessagingConfig>,
        ];

        return {
          queueName: messagingConfig.jobQueueName,
          defaultJobName: messagingConfig.jobPattern,
        };
      },
    }),
    StorageModule.registerAsync({
      imports: [scraperConfigModule],
      inject: [scraperStorageConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [storageConfig] = args as [
          ConfigType<typeof scraperStorageConfig>,
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
    StructuredLoggerModule.register({ serviceName: 'scraper' }),
  ],
  controllers: [],
  providers: [
    {
      provide: SCRAPE_STATUS_QUEUE_TOKEN,
      useFactory: (...args: unknown[]) => {
        const [messagingConfig] = args as [
          ConfigType<typeof scraperMessagingConfig>,
        ];

        return new BullMqMessageQueue(
          resolveBullMqMessagingOptions({
            queueName: messagingConfig.statusQueueName,
            defaultJobName: messagingConfig.statusPattern,
          }),
        );
      },
      inject: [scraperMessagingConfig.KEY],
    },
    ScrapeEngineService,
    ScrapeWorkerService,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import {
  BullMqMessageQueue,
  MessagingModule,
  resolveBullMqMessagingOptions,
  resolveRedisConnection,
} from '@org/messaging';
import { StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import {
  scraperMessagingConfig,
  scraperConfigModule,
  scraperRedisConfig,
  scraperStorageConfig,
} from './app.config';
import { SCRAPE_STATUS_QUEUE_TOKEN } from './scrape.constants';
import { ScrapeEngineService } from './scrape-engine.service';
import { ScrapeWorkerService } from './scrape-worker.service';

@Module({
  imports: [
    scraperConfigModule,
    MessagingModule.registerAsync({
      imports: [scraperConfigModule],
      inject: [scraperMessagingConfig.KEY, scraperRedisConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [messagingConfig, redisConfig] = args as [
          ConfigType<typeof scraperMessagingConfig>,
          ConfigType<typeof scraperRedisConfig>,
        ];

        return {
          queueName: messagingConfig.jobQueueName,
          defaultJobName: messagingConfig.jobPattern,
          connection: resolveRedisConnection(redisConfig.url),
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
        const [messagingConfig, redisConfig] = args as [
          ConfigType<typeof scraperMessagingConfig>,
          ConfigType<typeof scraperRedisConfig>,
        ];

        return new BullMqMessageQueue(
          resolveBullMqMessagingOptions({
            queueName: messagingConfig.statusQueueName,
            defaultJobName: messagingConfig.statusPattern,
            connection: resolveRedisConnection(redisConfig.url),
          }),
        );
      },
      inject: [scraperMessagingConfig.KEY, scraperRedisConfig.KEY],
    },
    ScrapeEngineService,
    ScrapeWorkerService,
  ],
})
export class AppModule { }


import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import {
  MessagingModule,
  RabbitMqMessageQueue,
  resolveRabbitMqMessagingOptions,
} from '@org/messaging';
import { PinoLoggerService, StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import {
  scraperMessagingConfig,
  scraperConfigModule,
  scraperRabbitMqConfig,
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
      inject: [scraperMessagingConfig.KEY, scraperRabbitMqConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [messagingConfig, rabbitMqConfig] = args as [
          ConfigType<typeof scraperMessagingConfig>,
          ConfigType<typeof scraperRabbitMqConfig>,
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
        const [messagingConfig, rabbitMqConfig, logger] = args as [
          ConfigType<typeof scraperMessagingConfig>,
          ConfigType<typeof scraperRabbitMqConfig>,
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
      inject: [scraperMessagingConfig.KEY, scraperRabbitMqConfig.KEY, PinoLoggerService],
    },
    ScrapeEngineService,
    ScrapeWorkerService,
  ],
})
export class AppModule { }


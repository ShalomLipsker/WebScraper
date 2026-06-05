import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BullMqMessageQueue,
  MessagingModule,
  resolveBullMqMessagingOptions,
} from '@org/messaging';
import { StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import {
  getAppConfig,
  scraperConfigModule,
} from './app.config';
import { ScrapeEngineService } from './scrape-engine.service';
import { ScrapeWorkerService } from './scrape-worker.service';

export const SCRAPE_STATUS_QUEUE_TOKEN = Symbol('SCRAPE_STATUS_QUEUE_TOKEN');

@Module({
  imports: [
    scraperConfigModule,
    MessagingModule.registerAsync({
      imports: [scraperConfigModule],
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
    StorageModule.registerAsync({
      imports: [scraperConfigModule],
      inject: [ConfigService],
      useFactory: (...args: unknown[]) => {
        const [configService] = args as [ConfigService];
        const appConfig = getAppConfig(configService);

        return {
          region: appConfig.storage.region,
          endpoint: appConfig.storage.endpoint,
          forcePathStyle: appConfig.storage.forcePathStyle,
          credentials:
            appConfig.storage.accessKeyId && appConfig.storage.secretAccessKey
              ? {
                  accessKeyId: appConfig.storage.accessKeyId,
                  secretAccessKey: appConfig.storage.secretAccessKey,
                }
              : undefined,
          defaultBucket: appConfig.storage.defaultBucket,
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
    ScrapeEngineService,
    ScrapeWorkerService,
  ],
})
export class AppModule {}

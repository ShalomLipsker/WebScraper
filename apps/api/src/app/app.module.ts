import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import { apiConfigModule, getAppConfig } from './app.config';
import { ScrapeGatewayService } from './scrape-gateway.service';
import { ScrapeController } from './scrape.controller';
import { registerJobManagerClient } from './job-manager-client';


@Module({
  imports: [
    apiConfigModule,
    StructuredLoggerModule.register({ serviceName: 'api' }),
    registerJobManagerClient(),
    StorageModule.registerAsync({
      imports: [apiConfigModule],
      inject: [ConfigService],
      useFactory: (...args) => {
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
  ],
  controllers: [ScrapeController],
  providers: [ScrapeGatewayService],
})
export class AppModule { }

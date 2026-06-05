import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { StructuredLoggerModule } from '@org/logger';
import { StorageModule } from '@org/storage';
import { apiConfigModule, apiStorageConfig } from './app.config';
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
      inject: [apiStorageConfig.KEY],
      useFactory: (...args) => {
        const [storageConfig] = args as [ConfigType<typeof apiStorageConfig>];

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
  ],
  controllers: [ScrapeController],
  providers: [ScrapeGatewayService],
})
export class AppModule { }

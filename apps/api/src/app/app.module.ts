import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';
import { apiConfigModule } from './app.config';
import { ScrapeGatewayService } from './scrape-gateway.service';
import { ScrapeController } from './scrape.controller';
import { registerJobManagerClient } from './job-manager-client';


@Module({
  imports: [
    apiConfigModule,
    StructuredLoggerModule.register({ serviceName: 'api' }),
    registerJobManagerClient(),
  ],
  controllers: [ScrapeController],
  providers: [ScrapeGatewayService],
})
export class AppModule { }

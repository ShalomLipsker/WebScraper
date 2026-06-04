import { Module } from '@nestjs/common';
import { MessagingModule } from '@org/messaging';
import { StructuredLoggerModule } from '@org/logger';
import { scraperConfigModule } from './app.config';
import { ScrapeEngineService } from './scrape-engine.service';
import { ScrapeWorkerService } from './scrape-worker.service';

@Module({
  imports: [
    scraperConfigModule,
    MessagingModule.register(),
    StructuredLoggerModule.register({ serviceName: 'scraper' }),
  ],
  controllers: [],
  providers: [ScrapeEngineService, ScrapeWorkerService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { MessagingModule } from '@org/messaging';
import { StructuredLoggerModule } from '@org/logger';
import { scraperConfigModule } from './app.config';
import { ScrapeWorkerService } from './scrape-worker.service';

@Module({
  imports: [
    scraperConfigModule,
    MessagingModule.register(),
    StructuredLoggerModule.register({ serviceName: 'scraper' }),
  ],
  controllers: [],
  providers: [ScrapeWorkerService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { MessagingModule } from '@org/messaging';
import { PersistenceModule } from '@org/persistence';
import { StructuredLoggerModule } from '@org/logger';
import { jobManagerConfigModule } from './app.config';
import { ScrapeJobsController } from './scrape-jobs.controller';
import { ScrapeJobsService } from './scrape-jobs.service';

@Module({
  imports: [
    jobManagerConfigModule,
    PersistenceModule.register(),
    MessagingModule.register(),
    StructuredLoggerModule.register({ serviceName: 'job-manager' }),
  ],
  controllers: [ScrapeJobsController],
  providers: [ScrapeJobsService],
})
export class AppModule {}

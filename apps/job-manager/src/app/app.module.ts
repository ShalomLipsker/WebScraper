import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';
import { jobManagerConfigModule } from './app.config';
import { ScrapeJobsController } from './scrape-jobs.controller';

@Module({
  imports: [
    jobManagerConfigModule,
    StructuredLoggerModule.register({ serviceName: 'job-manager' }),
  ],
  controllers: [ScrapeJobsController],
  providers: [],
})
export class AppModule {}

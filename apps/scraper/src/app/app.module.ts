import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';
import { scraperConfigModule } from './app.config';

@Module({
  imports: [
    scraperConfigModule,
    StructuredLoggerModule.register({ serviceName: 'scraper' }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

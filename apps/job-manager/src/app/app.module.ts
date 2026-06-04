import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';
import { jobManagerConfigModule } from './app.config';

@Module({
  imports: [
    jobManagerConfigModule,
    StructuredLoggerModule.register({ serviceName: 'job-manager' }),
  ],
  providers: [],
})
export class AppModule {}

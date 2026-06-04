import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';

@Module({
  imports: [StructuredLoggerModule.register({ serviceName: 'job-manager' })],
  controllers: [],
  providers: [],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';
import { apiConfigModule } from './app.config';

@Module({
  imports: [
    apiConfigModule,
    StructuredLoggerModule.register({ serviceName: 'api' }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

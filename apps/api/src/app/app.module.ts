import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';

@Module({
  imports: [StructuredLoggerModule.register({ serviceName: 'api' })],
  controllers: [],
  providers: [],
})
export class AppModule {}

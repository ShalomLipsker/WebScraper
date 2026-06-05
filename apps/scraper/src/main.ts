import { type ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@org/logger';
import { scraperServiceConfig } from './app/app.config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const serviceConfig = app.get<ConfigType<typeof scraperServiceConfig>>(
    scraperServiceConfig.KEY,
  );
  const logger = app.get(PinoLoggerService);

  app.useLogger(logger);
  app.flushLogs();

  await app.listen(serviceConfig.http.port);
  logger.log(`scraper listening on http://localhost:${serviceConfig.http.port}`);
}

bootstrap();

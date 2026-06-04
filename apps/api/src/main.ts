import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@org/logger';
import { getAppConfig } from './app/app.config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = getAppConfig(app.get(ConfigService));
  const logger = app.get(PinoLoggerService);

  app.useLogger(logger);
  app.flushLogs();

  await app.listen(config.http.port);
  logger.log(`api listening on http://localhost:${config.http.port}`);
}

bootstrap();

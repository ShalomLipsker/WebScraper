import { ValidationPipe } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@org/logger';
import { apiServiceConfig } from './app/app.config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const serviceConfig = app.get<ConfigType<typeof apiServiceConfig>>(
    apiServiceConfig.KEY,
  );
  const logger = app.get(PinoLoggerService);

  app.useLogger(logger);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.flushLogs();

  await app.listen(serviceConfig.http.port);
  logger.log({
    event: 'service listening',
    service: 'api',
    port: serviceConfig.http.port,
    url: `http://localhost:${serviceConfig.http.port}`,
  });
}

bootstrap();

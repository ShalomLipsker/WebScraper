import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { PinoLoggerService } from '@org/logger';
import { getAppConfig } from './app/app.config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const loggerApp = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = getAppConfig(loggerApp.get(ConfigService));
  const logger = loggerApp.get(PinoLoggerService);
  const app = loggerApp.connectMicroservice({
    transport: Transport.TCP,
    options: {
      host: config.transport.host,
      port: config.transport.tcpPort,
    },
  });

  app.useLogger(logger);
  loggerApp.useLogger(logger);
  loggerApp.flushLogs();

  await loggerApp.startAllMicroservices();
  await loggerApp.listen(config.http.port);
  logger.log(`job-manager listening on http://localhost:${config.http.port}`);
  logger.log(
    `job-manager TCP transport listening on ${config.transport.host}:${config.transport.tcpPort}`,
  );
}

bootstrap();

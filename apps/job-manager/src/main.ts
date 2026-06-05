import { type ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { PinoLoggerService } from '@org/logger';
import {
  jobManagerServiceConfig,
  jobManagerTransportConfig,
} from './app/app.config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const loggerApp = await NestFactory.create(AppModule, { bufferLogs: true });
  const serviceConfig = loggerApp.get<ConfigType<typeof jobManagerServiceConfig>>(
    jobManagerServiceConfig.KEY,
  );
  const transportConfig = loggerApp.get<ConfigType<typeof jobManagerTransportConfig>>(
    jobManagerTransportConfig.KEY,
  );
  const logger = loggerApp.get(PinoLoggerService);
  const app = loggerApp.connectMicroservice({
    transport: Transport.TCP,
    options: {
      host: transportConfig.host,
      port: transportConfig.tcpPort,
    },
  });

  app.useLogger(logger);
  loggerApp.useLogger(logger);
  loggerApp.flushLogs();

  await loggerApp.startAllMicroservices();
  await loggerApp.listen(serviceConfig.http.port);
  logger.log(`job-manager listening on http://localhost:${serviceConfig.http.port}`);
  logger.log(
    `job-manager TCP transport listening on ${transportConfig.host}:${transportConfig.tcpPort}`,
  );
}

bootstrap();

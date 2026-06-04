import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@org/logger';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(PinoLoggerService);

  app.useLogger(logger);
  app.flushLogs();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`api listening on http://localhost:${port}`);
}

bootstrap();

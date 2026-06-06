import './instrumentation';

async function bootstrap() {
  const [{ ValidationPipe }, { NestFactory }, { PinoLoggerService }, { apiServiceConfig }, { AppModule }] = await Promise.all([
    import('@nestjs/common'),
    import('@nestjs/core'),
    import('@org/logger'),
    import('./app/app.config'),
    import('./app/app.module'),
  ]);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const serviceConfig = app.get(apiServiceConfig.KEY);
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

void bootstrap();

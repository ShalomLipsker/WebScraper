import './instrumentation';

async function bootstrap() {
  const [{ NestFactory }, { PinoLoggerService }, { scraperServiceConfig }, { AppModule }] = await Promise.all([
    import('@nestjs/core'),
    import('@org/logger'),
    import('./app/app.config.js'),
    import('./app/app.module.js'),
  ]);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const serviceConfig = app.get(scraperServiceConfig.KEY);
  const logger = app.get(PinoLoggerService);

  app.useLogger(logger);
  app.flushLogs();

  await app.listen(serviceConfig.http.port);
  logger.log({
    event: 'service listening',
    service: 'scraper',
    port: serviceConfig.http.port,
    url: `http://localhost:${serviceConfig.http.port}`,
  });
}

void bootstrap();

import './instrumentation';

async function bootstrap() {
  const [{ NestFactory }, { Transport }, { PinoLoggerService }, { jobManagerServiceConfig, jobManagerTransportConfig }, { AppModule }] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/microservices'),
    import('@org/logger'),
    import('./app/app.config'),
    import('./app/app.module'),
  ]);
  const loggerApp = await NestFactory.create(AppModule, { bufferLogs: true });
  const serviceConfig = loggerApp.get(jobManagerServiceConfig.KEY);
  const transportConfig = loggerApp.get(jobManagerTransportConfig.KEY);
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
  logger.log({
    event: 'service listening',
    service: 'job-manager',
    port: serviceConfig.http.port,
    url: `http://localhost:${serviceConfig.http.port}`,
  });
  logger.log({
    event: 'service transport listening',
    service: 'job-manager',
    host: transportConfig.host,
    port: transportConfig.tcpPort,
    transport: 'tcp',
  });
}

void bootstrap();

# @org/logger

Shared NestJS logging module for the scraping pipeline.

This package wraps `nestjs-pino` behind a small `StructuredLoggerModule`
interface so each application can opt into the same structured JSON logging
defaults while still declaring its own service name.

## Usage

```ts
import { Module } from '@nestjs/common';
import { StructuredLoggerModule } from '@org/logger';

@Module({
	imports: [StructuredLoggerModule.register({ serviceName: 'api' })],
})
export class AppModule {}
```

In your Nest bootstrap:

```ts
import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@org/logger';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
const logger = app.get(PinoLoggerService);

app.useLogger(logger);
app.flushLogs();
```

The logger emits JSON logs with ISO timestamps, stable request IDs, a `service`
field, and basic request/response metadata.

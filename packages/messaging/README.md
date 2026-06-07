# @org/messaging

Shared RabbitMQ messaging adapter for the scraping pipeline.

This package provides the common message queue abstraction and the RabbitMQ
implementation used by the API, job-manager, and scraper services.

## Build

Run `pnpm nx build messaging` to build the library.

## Tests

This package currently has focused RabbitMQ integration tests for
`RabbitMqMessageQueue` in `test/rabbitmq-message-queue.integration.spec.ts`.

Run the package tests with `pnpm --filter @org/messaging test`.
The integration suite expects RabbitMQ to be available at `amqp://127.0.0.1:5672`
unless `RABBITMQ_URL` is set.
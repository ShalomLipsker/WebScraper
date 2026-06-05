import { Buffer } from 'node:buffer';

import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PinoLoggerService } from '@org/logger';
import {
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
  type Options,
} from 'amqplib';
import * as amqplib from 'amqplib';

import {
  DEFAULT_JOB_ATTEMPTS,
  RABBITMQ_MESSAGING_OPTIONS_TOKEN,
} from './messaging.constants.js';
import type {
  IMessageQueue,
  IMessageWorker,
  MessageHandler,
  MessageWorkerRegistrationOptions,
  PublishedQueueMessage,
  QueueMessageHeaderValue,
  QueueMessage,
  QueuePublishOptions,
  ResolvedRabbitMqMessagingModuleOptions,
} from './messaging.types.js';

const INTERNAL_HEADER_NAMES = new Set(['attemptsMade', 'maxAttempts', 'backoffDelayMs']);

@Injectable()
export class RabbitMqMessageQueue implements IMessageQueue, OnModuleDestroy {
  private publishConnection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private readonly workers = new Set<RabbitMqWorkerHandle>();

  constructor(
    @Inject(RABBITMQ_MESSAGING_OPTIONS_TOKEN)
    private readonly options: ResolvedRabbitMqMessagingModuleOptions,
    @Optional()
    private readonly logger?: PinoLoggerService,
  ) {}

  async publish<TPayload>(
    message: QueueMessage<TPayload>,
    options: QueuePublishOptions = {},
  ): Promise<PublishedQueueMessage<TPayload>> {
    const channel = await this.getPublishChannel();
    const resolvedName = message.name ?? this.options.defaultJobName;
    const resolvedAttempts =
      options.attempts ?? this.options.defaultPublishOptions.attempts ?? DEFAULT_JOB_ATTEMPTS;
    const resolvedBackoff = options.backoff ?? this.options.defaultPublishOptions.backoff;
    const payload = Buffer.from(JSON.stringify(message.data));

    await assertTopology(channel, this.options, resolvedName);
    await publishWithConfirm(
      channel,
      this.options.exchange,
      resolvedName,
      payload,
      createPublishProperties(
        message.id,
        resolvedName,
        0,
        resolvedAttempts,
        resolvedBackoff?.delayMs,
        undefined,
        options.headers,
      ),
    );

    this.logger?.log({
      event: 'published RabbitMQ message',
      messageId: message.id,
      messageName: resolvedName,
      queueName: this.options.queueName,
      exchange: this.options.exchange,
      attempts: resolvedAttempts,
      backoffDelayMs: resolvedBackoff?.delayMs ?? 0,
    });

    return {
      ...message,
      name: resolvedName,
      queueName: this.options.queueName,
      attempts: resolvedAttempts,
    };
  }

  async registerHandler<TPayload, TResult = void>(
    handler: MessageHandler<TPayload, TResult>,
    options: MessageWorkerRegistrationOptions = {},
  ): Promise<IMessageWorker> {
    this.logger?.log({
      event: 'registering RabbitMQ worker',
      queueName: this.options.queueName,
      concurrency: options.concurrency ?? this.options.prefetchCount,
    });

    const connection = await amqplib.connect(this.options.url);
    const channel = await connection.createChannel();
    const resolvedConcurrency = options.concurrency ?? this.options.prefetchCount;

    await assertTopology(channel, this.options, this.options.defaultJobName);
    await channel.prefetch(resolvedConcurrency);

    const consumeResult = await channel.consume(
      this.options.queueName,
      async (message) => {
        if (!message) {
          return;
        }

        await this.handleMessage(channel, message, handler);
      },
      { noAck: false },
    );

    const worker: RabbitMqWorkerHandle = {
      connection,
      channel,
      consumerTag: consumeResult.consumerTag,
    };

    this.workers.add(worker);

    this.logger?.log({
      event: 'registered RabbitMQ worker',
      queueName: this.options.queueName,
      consumerTag: consumeResult.consumerTag,
      concurrency: resolvedConcurrency,
    });

    return {
      close: async () => {
        await this.closeWorker(worker);
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.logger?.log({
      event: 'shutting down RabbitMQ queue',
      queueName: this.options.queueName,
      activeWorkers: this.workers.size,
    });

    await Promise.all(Array.from(this.workers, async (worker) => {
      await this.closeWorker(worker);
    }));

    if (this.publishChannel) {
      await this.publishChannel.close();
      this.publishChannel = null;
    }

    if (this.publishConnection) {
      await this.publishConnection.close();
      this.publishConnection = null;
    }
  }

  private async handleMessage<TPayload, TResult>(
    channel: Channel,
    rawMessage: ConsumeMessage,
    handler: MessageHandler<TPayload, TResult>,
  ): Promise<void> {
    const decoded = decodeMessage<TPayload>(rawMessage, this.options.defaultPublishOptions.attempts);

    this.logger?.log({
      event: 'processing RabbitMQ message',
      messageId: decoded.id,
      messageName: decoded.name,
      queueName: this.options.queueName,
      attempt: decoded.attemptsMade + 1,
      maxAttempts: decoded.maxAttempts,
    });

    try {
      await handler(decoded);
      channel.ack(rawMessage);
      this.logger?.log({
        event: 'acknowledged RabbitMQ message',
        messageId: decoded.id,
        messageName: decoded.name,
        queueName: this.options.queueName,
        attempt: decoded.attemptsMade + 1,
      });
    } catch (error: unknown) {
      if (decoded.attemptsMade + 1 >= decoded.maxAttempts) {
        if (shouldDeadLetterOnExhaustion(error)) {
          // Route exhausted poison messages to the terminal dead-letter queue.
          this.logger?.error({
            event: 'dead-lettering exhausted RabbitMQ message',
            messageId: decoded.id,
            messageName: decoded.name,
            queueName: this.options.queueName,
            attempt: decoded.attemptsMade + 1,
            maxAttempts: decoded.maxAttempts,
            errorMessage: toErrorMessage(error),
          });
          channel.nack(rawMessage, false, false);
          return;
        }

        this.logger?.error({
          event: 'acknowledging exhausted RabbitMQ message',
          messageId: decoded.id,
          messageName: decoded.name,
          queueName: this.options.queueName,
          attempt: decoded.attemptsMade + 1,
          maxAttempts: decoded.maxAttempts,
          errorMessage: toErrorMessage(error),
        });
        channel.ack(rawMessage);
        return;
      }

      try {
        await this.publishRetry(channel, rawMessage, decoded);
        channel.ack(rawMessage);
        this.logger?.warn({
          event: 'requeued RabbitMQ message for retry',
          messageId: decoded.id,
          messageName: decoded.name,
          queueName: this.options.queueName,
          retryQueueName: this.options.retryQueueName,
          nextAttempt: decoded.attemptsMade + 2,
          maxAttempts: decoded.maxAttempts,
          backoffDelayMs: decoded.backoffDelayMs,
          errorMessage: toErrorMessage(error),
        });
      } catch {
        this.logger?.error({
          event: 'failed to requeue RabbitMQ message',
          messageId: decoded.id,
          messageName: decoded.name,
          queueName: this.options.queueName,
          retryQueueName: this.options.retryQueueName,
        });
        channel.nack(rawMessage, false, true);
      }
    }
  }

  private async publishRetry<TPayload>(
    channel: Channel,
    rawMessage: ConsumeMessage,
    decoded: {
      id: string;
      name: string;
      data: TPayload;
      attemptsMade: number;
      maxAttempts: number;
      timestamp: number;
      backoffDelayMs: number;
    },
  ): Promise<void> {
    this.logger?.warn({
      event: 'publishing RabbitMQ retry',
      messageId: decoded.id,
      messageName: decoded.name,
      queueName: this.options.queueName,
      retryQueueName: this.options.retryQueueName,
      nextAttempt: decoded.attemptsMade + 2,
      maxAttempts: decoded.maxAttempts,
      backoffDelayMs: decoded.backoffDelayMs,
    });

    await channel.sendToQueue(
      this.options.retryQueueName,
      rawMessage.content,
      createPublishProperties(
        decoded.id,
        decoded.name,
        decoded.attemptsMade + 1,
        decoded.maxAttempts,
        decoded.backoffDelayMs,
        String(decoded.backoffDelayMs),
        extractRetryHeaders(rawMessage.properties.headers),
      ),
    );
  }

  private async getPublishChannel(): Promise<ConfirmChannel> {
    if (this.publishChannel) {
      return this.publishChannel;
    }

    this.logger?.log({
      event: 'opening RabbitMQ publisher connection',
      queueName: this.options.queueName,
      exchange: this.options.exchange,
      url: this.options.url,
    });

    this.publishConnection = await amqplib.connect(this.options.url);
    this.publishChannel = await this.publishConnection.createConfirmChannel();

    this.logger?.log({
      event: 'opened RabbitMQ publisher channel',
      queueName: this.options.queueName,
      exchange: this.options.exchange,
    });

    return this.publishChannel;
  }

  private async closeWorker(worker: RabbitMqWorkerHandle): Promise<void> {
    if (!this.workers.has(worker)) {
      return;
    }

    this.workers.delete(worker);
    this.logger?.log({
      event: 'closing RabbitMQ worker',
      queueName: this.options.queueName,
      consumerTag: worker.consumerTag,
    });
    await worker.channel.cancel(worker.consumerTag);
    await worker.channel.close();
    await worker.connection.close();
  }
}

interface RabbitMqWorkerHandle {
  connection: ChannelModel;
  channel: Channel;
  consumerTag: string;
}

async function assertTopology(
  channel: Channel | ConfirmChannel,
  options: ResolvedRabbitMqMessagingModuleOptions,
  routingKey: string,
): Promise<void> {
  await channel.assertExchange(options.exchange, options.exchangeType, {
    durable: options.durable,
  });
  await channel.assertQueue(options.queueName, {
    durable: options.durable,
    deadLetterExchange: options.exchange,
    deadLetterRoutingKey: options.deadLetterQueueName,
    arguments: createQueueArguments(options),
  });
  await channel.bindQueue(options.queueName, options.exchange, routingKey);
  await channel.assertQueue(options.retryQueueName, {
    durable: options.durable,
    deadLetterExchange: options.exchange,
    deadLetterRoutingKey: routingKey,
  });
  await channel.assertQueue(options.deadLetterQueueName, {
    durable: options.durable,
  });
  await channel.bindQueue(
    options.deadLetterQueueName,
    options.exchange,
    options.deadLetterQueueName,
  );
}

function createQueueArguments(
  options: ResolvedRabbitMqMessagingModuleOptions,
): Record<string, boolean> | undefined {
  if (!options.queueDeduplication.enabled) {
    return undefined;
  }

  return {
    'x-message-deduplication': true,
  };
}

function createPublishProperties(
  messageId: string,
  messageName: string,
  attemptsMade: number,
  maxAttempts: number,
  backoffDelayMs?: number,
  expiration?: string,
  extraHeaders: Record<string, QueueMessageHeaderValue> = {},
): Options.Publish {
  return {
    persistent: true,
    messageId,
    type: messageName,
    timestamp: Date.now(),
    contentType: 'application/json',
    expiration,
    headers: {
      ...extraHeaders,
      attemptsMade,
      maxAttempts,
      backoffDelayMs: backoffDelayMs ?? 0,
    },
  };
}

function extractRetryHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, QueueMessageHeaderValue> {
  if (!headers) {
    return {};
  }

  const preservedHeaders = Object.entries(headers).reduce<Record<string, QueueMessageHeaderValue>>(
    (result, [key, value]) => {
      if (INTERNAL_HEADER_NAMES.has(key)) {
        return result;
      }

      if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
      ) {
        result[key] = value;
      }

      return result;
    },
    {},
  );

  return preservedHeaders;
}

function decodeMessage<TPayload>(
  message: ConsumeMessage,
  fallbackMaxAttempts: number | undefined,
): {
  id: string;
  name: string;
  data: TPayload;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: number;
  backoffDelayMs: number;
} {
  const headers = message.properties.headers ?? {};

  return {
    id: message.properties.messageId ?? '',
    name: message.properties.type ?? '',
    data: JSON.parse(message.content.toString('utf8')) as TPayload,
    attemptsMade: Number(headers.attemptsMade ?? 0),
    maxAttempts: Number(headers.maxAttempts ?? fallbackMaxAttempts ?? DEFAULT_JOB_ATTEMPTS),
    timestamp: message.properties.timestamp ?? Date.now(),
    backoffDelayMs: Number(headers.backoffDelayMs ?? 0),
  };
}

function shouldDeadLetterOnExhaustion(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'deadLetterOnExhaustion' in error
    && (error as { deadLetterOnExhaustion?: boolean }).deadLetterOnExhaustion,
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown RabbitMQ processing failure';
}

function publishWithConfirm(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  payload: Buffer,
  options: Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, payload, options, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
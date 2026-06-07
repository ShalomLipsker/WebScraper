import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import * as amqplib from 'amqplib';
import type { Channel, GetMessage } from 'amqplib';
import { afterEach, describe, expect, it } from 'vitest';

import { RABBITMQ_CORRELATION_ID_HEADER } from '../src/lib/messaging.constants.js';
import { resolveRabbitMqMessagingOptions } from '../src/lib/messaging.module.js';
import { RabbitMqMessageQueue } from '../src/lib/rabbitmq-message-queue.js';
import type {
  QueueHandlerMessage,
  QueuePublishOptions,
  ResolvedRabbitMqMessagingModuleOptions,
} from '../src/lib/messaging.types.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://127.0.0.1:5672';

describe('RabbitMqMessageQueue integration', { concurrent: false }, () => {
  const harnesses = new Set<MessagingTestHarness>();

  afterEach(async () => {
    await Promise.all(Array.from(harnesses, async (harness) => {
      await harness.cleanup();
      harnesses.delete(harness);
    }));
  });

  it('publish sends a message to the configured queue and the handler receives the expected payload', async () => {
    const harness = await createHarness('publish-consume');
    harnesses.add(harness);

    const received = createDeferred<QueueHandlerMessage<{ value: string }>>();
    const worker = await harness.queue.registerHandler<{ value: string }>(async (message) => {
      received.resolve(message);
    });

    await harness.queue.publish({
      id: 'job-1',
      name: harness.routingKey,
      data: { value: 'hello' },
    });

    await expect(received.promise).resolves.toMatchObject({
      id: 'job-1',
      name: harness.routingKey,
      data: { value: 'hello' },
      attemptsMade: 0,
      maxAttempts: harness.options.defaultPublishOptions.attempts,
    });

    await worker.close();
  });

  it('publish applies the default job name when message.name is omitted', async () => {
    const harness = await createHarness('default-name');
    harnesses.add(harness);

    const received = createDeferred<QueueHandlerMessage<{ value: number }>>();
    const worker = await harness.queue.registerHandler<{ value: number }>(async (message) => {
      received.resolve(message);
    });

    const published = await harness.queue.publish({
      id: 'job-2',
      data: { value: 42 },
    });

    expect(published.name).toBe(harness.options.defaultJobName);
    await expect(received.promise).resolves.toMatchObject({
      id: 'job-2',
      name: harness.options.defaultJobName,
      data: { value: 42 },
    });

    await worker.close();
  });

  it('registerHandler acknowledges a successfully processed message so it is not redelivered', async () => {
    const harness = await createHarness('ack-success');
    harnesses.add(harness);

    let calls = 0;
    const handled = createDeferred<void>();
    const worker = await harness.queue.registerHandler(async () => {
      calls += 1;
      handled.resolve();
    });

    await harness.queue.publish({
      id: 'job-3',
      name: harness.routingKey,
      data: { ok: true },
    });

    await handled.promise;
    await worker.close();
    await waitFor(async () => {
      const status = await harness.adminChannel.checkQueue(harness.options.queueName);
      return status.messageCount === 0;
    });

    const secondWorker = await harness.queue.registerHandler(async () => {
      calls += 1;
    });

    await delay(200);
    expect(calls).toBe(1);
    await secondWorker.close();
  });

  it('handler failure republishes the message to the retry queue with incremented attemptsMade', async () => {
    const harness = await createHarness('retry-republish', {
      defaultPublishOptions: {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delayMs: 5_000,
        },
      },
    });
    harnesses.add(harness);

    const firstAttempt = createDeferred<void>();
    const worker = await harness.queue.registerHandler(async () => {
      firstAttempt.resolve();
      throw new Error('retry me');
    });

    await harness.queue.publish({
      id: 'job-4',
      name: harness.routingKey,
      data: { retry: true },
    });

    await firstAttempt.promise;
    const retryMessage = await waitForQueueMessage(
      harness.adminChannel,
      harness.options.retryQueueName,
    );

    expect(retryMessage?.properties.headers).toMatchObject({
      attemptsMade: 1,
      maxAttempts: 3,
      backoffDelayMs: 5_000,
    });
    expect(retryMessage?.properties.expiration).toBe('5000');

    await worker.close();
  });

  it('an exhausted handler error without deadLetterOnExhaustion is acknowledged and not dead-lettered', async () => {
    const harness = await createHarness('ack-exhausted', {
      defaultPublishOptions: {
        attempts: 1,
      },
    });
    harnesses.add(harness);

    const attempted = createDeferred<void>();
    const worker = await harness.queue.registerHandler(async () => {
      attempted.resolve();
      throw new Error('done retrying');
    });

    await harness.queue.publish({
      id: 'job-5',
      name: harness.routingKey,
      data: { fail: true },
    });

    await attempted.promise;
    await waitFor(async () => {
      const main = await harness.adminChannel.checkQueue(harness.options.queueName);
      const retry = await harness.adminChannel.checkQueue(harness.options.retryQueueName);
      const deadLetter = await harness.adminChannel.checkQueue(harness.options.deadLetterQueueName);

      return main.messageCount === 0
        && retry.messageCount === 0
        && deadLetter.messageCount === 0;
    });

    await worker.close();
  });

  it('an exhausted handler error with deadLetterOnExhaustion is routed to the dead-letter queue', async () => {
    const harness = await createHarness('dead-letter', {
      defaultPublishOptions: {
        attempts: 1,
      },
    });
    harnesses.add(harness);

    const attempted = createDeferred<void>();
    const worker = await harness.queue.registerHandler(async () => {
      attempted.resolve();
      const error = new Error('poison message') as Error & {
        deadLetterOnExhaustion?: boolean;
      };
      error.deadLetterOnExhaustion = true;
      throw error;
    });

    await harness.queue.publish({
      id: 'job-6',
      name: harness.routingKey,
      data: { poison: true },
    });

    await attempted.promise;
    const deadLetterMessage = await waitForQueueMessage(
      harness.adminChannel,
      harness.options.deadLetterQueueName,
    );

    expect(deadLetterMessage?.properties.messageId).toBe('job-6');
    expect(deadLetterMessage?.properties.type).toBe(harness.routingKey);

    await worker.close();
  });

  it('custom headers and correlation id are preserved when the handler receives the message', async () => {
    const harness = await createHarness('headers-correlation');
    harnesses.add(harness);

    const received = createDeferred<QueueHandlerMessage<{ trace: string }>>();
    const worker = await harness.queue.registerHandler<{ trace: string }>(async (message) => {
      received.resolve(message);
    });

    await harness.queue.publish(
      {
        id: 'job-7',
        name: harness.routingKey,
        data: { trace: 'abc' },
      },
      {
        correlationId: 'corr-7',
        headers: {
          customHeader: 'present',
          priority: 7,
          enabled: true,
        },
      },
    );

    await expect(received.promise).resolves.toMatchObject({
      correlationId: 'corr-7',
      headers: {
        customHeader: 'present',
        priority: 7,
        enabled: true,
        [RABBITMQ_CORRELATION_ID_HEADER]: 'corr-7',
      },
    });

    await worker.close();
  });

  it('custom retry-safe headers survive a retry while internal retry headers are normalized', async () => {
    const harness = await createHarness('retry-headers', {
      defaultPublishOptions: {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delayMs: 4_000,
        },
      },
    });
    harnesses.add(harness);

    const attempted = createDeferred<void>();
    const worker = await harness.queue.registerHandler(async () => {
      attempted.resolve();
      throw new Error('retry with headers');
    });

    await harness.queue.publish(
      {
        id: 'job-8',
        name: harness.routingKey,
        data: { retry: 'headers' },
      },
      {
        headers: {
          [RABBITMQ_CORRELATION_ID_HEADER]: 'corr-8',
          customHeader: 'keep-me',
          featureFlag: true,
          attemptsMade: 99,
          maxAttempts: 999,
          backoffDelayMs: 777,
        },
      } as QueuePublishOptions,
    );

    await attempted.promise;
    const retryMessage = await waitForQueueMessage(
      harness.adminChannel,
      harness.options.retryQueueName,
    );

    expect(retryMessage?.properties.headers).toMatchObject({
      [RABBITMQ_CORRELATION_ID_HEADER]: 'corr-8',
      customHeader: 'keep-me',
      featureFlag: true,
      attemptsMade: 1,
      maxAttempts: 3,
      backoffDelayMs: 4_000,
    });

    await worker.close();
  });
});

interface MessagingTestHarness {
  queue: RabbitMqMessageQueue;
  options: ResolvedRabbitMqMessagingModuleOptions;
  routingKey: string;
  adminConnection: amqplib.ChannelModel;
  adminChannel: Channel;
  cleanup: () => Promise<void>;
}

async function createHarness(
  label: string,
  overrides: Partial<ResolvedRabbitMqMessagingModuleOptions['defaultPublishOptions']> & {
    defaultPublishOptions?: QueuePublishOptions;
  } & Partial<
    Omit<ResolvedRabbitMqMessagingModuleOptions, 'defaultPublishOptions'>
  > = {},
): Promise<MessagingTestHarness> {
  const suffix = randomUUID();
  const queueName = `messaging.${label}.${suffix}`;
  const exchange = `messaging.exchange.${suffix}`;
  const options = resolveRabbitMqMessagingOptions({
    url: RABBITMQ_URL,
    queueName,
    exchange,
    durable: false,
    defaultJobName: `job.${suffix}`,
    prefetchCount: 1,
    ...(overrides.queueName ? { queueName: overrides.queueName } : {}),
    ...(overrides.exchange ? { exchange: overrides.exchange } : {}),
    ...(overrides.defaultJobName
      ? { defaultJobName: overrides.defaultJobName }
      : {}),
    ...(overrides.defaultPublishOptions
      ? { defaultPublishOptions: overrides.defaultPublishOptions }
      : {}),
  });
  const queue = new RabbitMqMessageQueue(options);
  const adminConnection = await amqplib.connect(options.url);
  const adminChannel = await adminConnection.createChannel();

  return {
    queue,
    options: {
      ...options,
      ...(overrides.retryQueueName ? { retryQueueName: overrides.retryQueueName } : {}),
      ...(overrides.deadLetterQueueName
        ? { deadLetterQueueName: overrides.deadLetterQueueName }
        : {}),
      ...(overrides.prefetchCount ? { prefetchCount: overrides.prefetchCount } : {}),
      ...(overrides.durable !== undefined ? { durable: overrides.durable } : {}),
    },
    routingKey: options.defaultJobName,
    adminConnection,
    adminChannel,
    cleanup: async () => {
      await queue.onModuleDestroy();
      await deleteIfExists(adminChannel, options.queueName);
      await deleteIfExists(adminChannel, options.retryQueueName);
      await deleteIfExists(adminChannel, options.deadLetterQueueName);
      await deleteExchangeIfExists(adminChannel, options.exchange);
      await adminChannel.close();
      await adminConnection.close();
    },
  };
}

async function deleteIfExists(channel: Channel, queueName: string): Promise<void> {
  try {
    await channel.deleteQueue(queueName);
  } catch {
    // Ignore cleanup failures if the queue does not exist anymore.
  }
}

async function deleteExchangeIfExists(
  channel: Channel,
  exchangeName: string,
): Promise<void> {
  try {
    await channel.deleteExchange(exchangeName);
  } catch {
    // Ignore cleanup failures if the exchange does not exist anymore.
  }
}

async function waitForQueueMessage(
  channel: Channel,
  queueName: string,
  timeoutMs = 5_000,
): Promise<GetMessage> {
  return waitFor(async () => {
    const message = await channel.get(queueName, { noAck: true });
    return message || false;
  }, timeoutMs);
}

async function waitFor<T>(
  probe: () => Promise<T | false>,
  timeoutMs = 5_000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await probe();

    if (result !== false) {
      return result;
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
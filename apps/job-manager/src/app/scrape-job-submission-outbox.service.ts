import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { PinoLoggerService } from '@org/logger';
import type { TraceContextCarrier } from '@org/domain';
import type { IMessageQueue } from '@org/messaging';
import {
  MESSAGE_QUEUE_TOKEN,
  RABBITMQ_BAGGAGE_HEADER,
  RABBITMQ_CORRELATION_ID_HEADER,
  RABBITMQ_DEDUPLICATION_HEADER,
  RABBITMQ_TRACEPARENT_HEADER,
  RABBITMQ_TRACESTATE_HEADER,
} from '@org/messaging';
import {
  OUTBOX_MESSAGE_STORE_TOKEN,
  type ClaimedOutboxMessage,
  type IOutboxMessageStore,
} from '@org/persistence';

import { jobManagerOutboxConfig } from './app.config';
import { PollingWorker } from './polling-worker';
import { timeout } from './timeout';

@Injectable()
export class ScrapeJobSubmissionOutboxService
  implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(jobManagerOutboxConfig.KEY)
    private readonly outboxConfig: ConfigType<typeof jobManagerOutboxConfig>,
    @Inject(OUTBOX_MESSAGE_STORE_TOKEN)
    private readonly outboxStore: IOutboxMessageStore,
    @Inject(MESSAGE_QUEUE_TOKEN)
    private readonly messageQueue: IMessageQueue,
    private readonly pollingWorker: PollingWorker,
    private readonly logger: PinoLoggerService,
  ) { }

  onModuleInit(): void {
    this.pollingWorker.start(() => this.processBatch());
  }

  onModuleDestroy(): Promise<void> {
    return this.pollingWorker.stop();
  }

  private async processBatch(): Promise<void> {
    try {
      const messages = await this.outboxStore.claimBatch({
        batchSize: this.outboxConfig.batchSize,
        maxAttempts: this.outboxConfig.maxAttempts,
      });

      await this.dispatchClaimedMessages(messages);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown outbox dispatch failure';

      this.logger.error({
        event: 'failed to poll outbox messages',
        errorMessage,
      });
    }
  }

  private async dispatchClaimedMessages(
    messages: Array<ClaimedOutboxMessage>,
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const resolvedConcurrency = Math.min(
      this.outboxConfig.dispatchConcurrency,
      messages.length,
    );
    let nextMessageIndex = 0;

    await Promise.all(Array.from({ length: resolvedConcurrency }, async () => {
      while (true) {
        const message = messages[nextMessageIndex];
        nextMessageIndex += 1;

        if (!message) {
          return;
        }

        await this.dispatchMessage(message);
      }
    }));
  }

  private async dispatchMessage(
    message: ClaimedOutboxMessage,
  ): Promise<void> {
    const correlationId = getCorrelationIdFromPayload(message.message.data);
    const traceContext = getTraceContextFromPayload(message.message.data);
    const nextAttempt = message.attemptCount + 1;
    const loggerContext = {
      correlationId,
      outboxId: message.outboxId,
      jobId: message.aggregateId,
      messageId: message.message.id,
      messageName: message.message.name,
      attempt: nextAttempt,
    }

    try {
      await timeout(
        'publish outbox message',
        this.outboxConfig.publishTimeoutMs,
        () => this.messageQueue.publish(message.message, {
          correlationId,
          headers: {
            [RABBITMQ_DEDUPLICATION_HEADER]: message.message.id,
            ...(correlationId
              ? { [RABBITMQ_CORRELATION_ID_HEADER]: correlationId }
              : {}),
            ...(traceContext?.traceparent
              ? { [RABBITMQ_TRACEPARENT_HEADER]: traceContext.traceparent }
              : {}),
            ...(traceContext?.tracestate
              ? { [RABBITMQ_TRACESTATE_HEADER]: traceContext.tracestate }
              : {}),
            ...(traceContext?.baggage
              ? { [RABBITMQ_BAGGAGE_HEADER]: traceContext.baggage }
              : {}),
          },
        }),
      );
      await timeout(
        'mark outbox message as published',
        this.outboxConfig.stateUpdateTimeoutMs,
        () => this.outboxStore.markJobEnqueuedAndPublished(
          message.aggregateId,
          message.outboxId,
        ),
      );

      this.logger.log({
        ...loggerContext,
        event: 'dispatched outbox message',
        outcome: 'published',
      });
    } catch (error: unknown) {
      const errorMessage = toErrorMessage(error);
      const exhausted = nextAttempt >= this.outboxConfig.maxAttempts;

      try {
        await timeout(
          exhausted
            ? 'record exhausted outbox message'
            : 'record failed outbox message',
          this.outboxConfig.stateUpdateTimeoutMs,
          () => this.outboxStore.markFailed(message.outboxId, errorMessage),
        );
      } catch (markFailedError: unknown) {
        this.logger.error({
          ...loggerContext,
          event: 'failed to persist outbox dispatch failure',
          maxAttempts: this.outboxConfig.maxAttempts,
          errorMessage,
          persistenceErrorMessage: toErrorMessage(markFailedError),
        });
      }

      this.logger.error({
        ...loggerContext,
        event: exhausted
          ? 'discarded outbox message after max attempts'
          : 'failed to dispatch outbox message',
        maxAttempts: this.outboxConfig.maxAttempts,
        errorMessage,
      });
    }
  }
}

function getCorrelationIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const correlationId = (payload as { correlationId?: unknown }).correlationId;

  return typeof correlationId === 'string' ? correlationId : undefined;
}

function getTraceContextFromPayload(
  payload: unknown,
): TraceContextCarrier | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const traceContext = (payload as { traceContext?: TraceContextCarrier }).traceContext;

  if (!traceContext) {
    return undefined;
  }

  if (
    typeof traceContext.traceparent !== 'string'
    && typeof traceContext.tracestate !== 'string'
    && typeof traceContext.baggage !== 'string'
  ) {
    return undefined;
  }

  return traceContext;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown outbox failure';
}
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { PinoLoggerService } from '@org/logger';
import type { IMessageQueue } from '@org/messaging';
import {
  MESSAGE_QUEUE_TOKEN,
  RABBITMQ_DEDUPLICATION_HEADER,
} from '@org/messaging';
import {
  OUTBOX_MESSAGE_STORE_TOKEN,
  type IOutboxMessageStore,
} from '@org/persistence';

import { jobManagerOutboxConfig } from './app.config';

@Injectable()
export class ScrapeJobSubmissionOutboxService
  implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private dispatchInFlight = false;

  constructor(
    @Inject(jobManagerOutboxConfig.KEY)
    private readonly outboxConfig: ConfigType<typeof jobManagerOutboxConfig>,
    @Inject(OUTBOX_MESSAGE_STORE_TOKEN)
    private readonly outboxStore: IOutboxMessageStore,
    @Inject(MESSAGE_QUEUE_TOKEN)
    private readonly messageQueue: IMessageQueue,
    private readonly logger: PinoLoggerService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.dispatchPendingMessages();
    }, this.outboxConfig.pollIntervalMs);

    void this.dispatchPendingMessages();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async dispatchPendingMessages(): Promise<void> {
    if (this.dispatchInFlight) {
      return;
    }

    this.dispatchInFlight = true;

    try {
      const messages = await this.outboxStore.claimBatch(this.outboxConfig.batchSize);

      for (const message of messages) {
        try {
          await this.messageQueue.publish(message.message, {
            headers: {
              [RABBITMQ_DEDUPLICATION_HEADER]: message.message.id,
            },
          });
          await this.outboxStore.markJobEnqueuedAndPublished(
            message.aggregateId,
            message.outboxId,
          );
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown outbox dispatch failure';

          await this.outboxStore.markFailed(message.outboxId, errorMessage);
          this.logger.error({
            event: 'failed to dispatch outbox message',
            outboxId: message.outboxId,
            jobId: message.aggregateId,
            messageId: message.message.id,
            messageName: message.message.name,
            errorMessage,
          });
        }
      }
    } finally {
      this.dispatchInFlight = false;
    }
  }
}
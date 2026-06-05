import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { PinoLoggerService, getDurationMs } from '@org/logger';
import {
  type IMessageQueue,
  type IMessageWorker,
  MESSAGE_QUEUE_TOKEN,
} from '@org/messaging';
import { S3StorageService } from '@org/storage';
import {
  type ScrapeJobStatusUpdatePayload,
  type SubmitScrapeJobPayload,
} from '@org/domain';
import { scraperMessagingConfig } from './app.config';
import { SCRAPE_STATUS_QUEUE_TOKEN } from './scrape.constants';
import { ScrapeEngineService } from './scrape-engine.service';

@Injectable()
export class ScrapeWorkerService implements OnModuleInit, OnModuleDestroy {
  private worker: IMessageWorker | null = null;

  constructor(
    @Inject(scraperMessagingConfig.KEY)
    private readonly messagingConfig: ConfigType<typeof scraperMessagingConfig>,
    @Inject(MESSAGE_QUEUE_TOKEN)
    private readonly messageQueue: IMessageQueue,
    @Inject(SCRAPE_STATUS_QUEUE_TOKEN)
    private readonly statusQueue: IMessageQueue,
    private readonly logger: PinoLoggerService,
    private readonly scrapeEngineService: ScrapeEngineService,
    private readonly storageService: S3StorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = await this.messageQueue.registerHandler<
      SubmitScrapeJobPayload,
      ScrapeJobCompletionResult
    >(
      async (message) => {
        const startedAt = Date.now();

        if (message.name !== this.messagingConfig.jobPattern) {
          return { status: 'IGNORED' };
        }

        await this.publishStatusUpdateOrThrow({
          jobId: message.id,
          correlationId: message.correlationId,
          status: 'PROCESSING',
        });

        const loggerContext = {
          correlationId: message.correlationId,
          jobId: message.id,
          messageName: message.name,
          sourceUrl: message.data.url,
          usedProxy: Boolean(message.data.proxy),
        }

        try {
          const html = await this.scrapeEngineService.fetchHtml(
            message.data.url,
            message.data.proxy,
            {
              jobId: message.id,
              correlationId: message.correlationId,
            },
          );
          const resultKey = createScrapeResultKey(message.id);

          await this.storageService.putText({
            key: resultKey,
            body: html,
            contentType: 'text/html; charset=utf-8',
            metadata: {
              jobId: message.id,
              sourceUrl: message.data.url,
            },
          });

          await this.publishStatusUpdateOrThrow({
            jobId: message.id,
            correlationId: message.correlationId,
            status: 'COMPLETED',
            resultPath: resultKey,
          });

          this.logger.log({
            ...loggerContext,
            event: 'completed scrape job',
            htmlLength: html.length,
            resultPath: resultKey,
            durationMs: getDurationMs(startedAt),
            outcome: 'completed',
          });

          return {
            status: 'COMPLETED' as const,
            resultPath: resultKey,
          };
        } catch (error: unknown) {
          if (error instanceof StatusPublishError) {
            this.logger.error({
              ...loggerContext,
              event: 'failed to publish scrape job status',

              errorMessage: error.message,
            });

            throw error;
          }

          const errorMessage = toErrorMessage(error);

          if (message.attemptsMade + 1 >= message.maxAttempts) {
            try {
              await this.publishStatusUpdate({
                jobId: message.id,
                correlationId: message.correlationId,
                status: 'FAILED',
                errorMessage,
              });
            } catch (publishError: unknown) {
              throw new StatusPublishError(toErrorMessage(publishError));
            }
          }

          this.logger.error({
            ...loggerContext,
            event: 'failed scrape job',
            attemptsMade: message.attemptsMade,
            maxAttempts: message.maxAttempts,
            errorMessage,
            durationMs: getDurationMs(startedAt),
          });

          throw error;
        }
      },
    );

    this.logger.log({
      event: 'registered RabbitMQ scrape worker',
      jobPattern: this.messagingConfig.jobPattern,
      statusPattern: this.messagingConfig.statusPattern,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    await this.worker.close();
    this.worker = null;
  }

  private async publishStatusUpdate(
    payload: ScrapeJobStatusUpdatePayload,
  ): Promise<void> {
    await this.statusQueue.publish({
      id: createStatusUpdateMessageId(payload.jobId, payload.status),
      name: this.messagingConfig.statusPattern,
      data: payload,
    }, {
      correlationId: payload.correlationId,
    });
  }

  private async publishStatusUpdateOrThrow(
    payload: ScrapeJobStatusUpdatePayload,
  ): Promise<void> {
    try {
      await this.publishStatusUpdate(payload);
    } catch (error: unknown) {
      throw new StatusPublishError(toErrorMessage(error));
    }
  }
}

interface ScrapeJobCompletionResult {
  status: 'COMPLETED' | 'IGNORED';
  resultPath?: string;
}

class StatusPublishError extends Error {
  readonly deadLetterOnExhaustion = true;
}

function createScrapeResultKey(jobId: string): string {
  return `scrape-results/${jobId}.html`;
}

function createStatusUpdateMessageId(
  jobId: string,
  status: ScrapeJobStatusUpdatePayload['status'],
): string {
  return `${jobId}-${status.toLowerCase()}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown scrape failure';
}
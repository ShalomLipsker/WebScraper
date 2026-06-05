import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { PinoLoggerService } from '@org/logger';
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
        if (message.name !== this.messagingConfig.jobPattern) {
          return { status: 'IGNORED' };
        }

        await this.publishStatusUpdate({
          jobId: message.id,
          status: 'PROCESSING',
        });

        try {
          const html = await this.scrapeEngineService.fetchHtml(message.data.url);
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

          await this.publishStatusUpdate({
            jobId: message.id,
            status: 'COMPLETED',
            resultPath: resultKey,
          });

          this.logger.log(
            `completed scrape job ${message.id} (${message.name}) and uploaded ${html.length} characters to ${resultKey}`,
          );

          return {
            status: 'COMPLETED' as const,
            resultPath: resultKey,
          };
        } catch (error: unknown) {
          const errorMessage = toErrorMessage(error);

          if (message.attemptsMade + 1 >= message.maxAttempts) {
            await this.publishStatusUpdate({
              jobId: message.id,
              status: 'FAILED',
              errorMessage,
            });
          }

          this.logger.error(
            `failed scrape job ${message.id} (${message.name}) for ${message.data.url}: ${errorMessage}`,
          );

          throw error;
        }
      },
    );

    this.logger.log('registered BullMQ scrape worker');
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
    });
  }
}

interface ScrapeJobCompletionResult {
  status: 'COMPLETED' | 'IGNORED';
  resultPath?: string;
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
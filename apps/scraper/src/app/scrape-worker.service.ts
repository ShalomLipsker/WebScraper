import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PinoLoggerService } from '@org/logger';
import {
  type IMessageQueue,
  type IMessageWorker,
  MESSAGE_QUEUE_TOKEN,
} from '@org/messaging';
import { SCRAPE_JOB_PATTERN, type SubmitScrapeJobPayload } from '@org/domain';
import { ScrapeEngineService } from './scrape-engine.service';

@Injectable()
export class ScrapeWorkerService implements OnModuleInit, OnModuleDestroy {
  private worker: IMessageWorker | null = null;

  constructor(
    @Inject(MESSAGE_QUEUE_TOKEN)
    private readonly messageQueue: IMessageQueue,
    private readonly logger: PinoLoggerService,
    private readonly scrapeEngineService: ScrapeEngineService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = await this.messageQueue.registerHandler<SubmitScrapeJobPayload>(
      async (message) => {
        if (message.name !== SCRAPE_JOB_PATTERN) {
          return;
        }

        const html = await this.scrapeEngineService.fetchHtml(message.data.url);

        this.logger.log(
          `fetched ${html.length} characters for scrape job ${message.id} (${message.name}) from ${message.data.url} on attempt ${message.attemptsMade}`,
        );
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
}
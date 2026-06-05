import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import type { IJobRepository, ScrapeJobStatusUpdatePayload } from '@org/domain';
import { PinoLoggerService } from '@org/logger';
import type { IMessageQueue, IMessageWorker } from '@org/messaging';
import { JOB_REPOSITORY_TOKEN } from '@org/persistence';
import { jobManagerMessagingConfig } from './app.config';
import { SCRAPE_STATUS_QUEUE_TOKEN } from './scrape.constants';

@Injectable()
export class ScrapeJobStatusUpdatesService
  implements OnModuleInit, OnModuleDestroy {
  private worker: IMessageWorker | null = null;

  constructor(
    @Inject(jobManagerMessagingConfig.KEY)
    private readonly messagingConfig: ConfigType<typeof jobManagerMessagingConfig>,
    @Inject(SCRAPE_STATUS_QUEUE_TOKEN)
    private readonly statusQueue: IMessageQueue,
    @Inject(JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: IJobRepository,
    private readonly logger: PinoLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = await this.statusQueue.registerHandler<
      ScrapeJobStatusUpdatePayload,
      { status: 'UPDATED' | 'IGNORED' }
    >(
      async (message) => {
        if (message.name !== this.messagingConfig.statusPattern) {
          return { status: 'IGNORED' };
        }

        await this.jobRepository.updateJobStatus(
          message.data.jobId,
          message.data.status,
          {
            resultPath: message.data.resultPath,
            errorMessage: message.data.errorMessage,
          },
        );

        this.logger.log(
          `applied scrape status update ${message.data.status} for job ${message.data.jobId}`,
        );

        return { status: 'UPDATED' };
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    await this.worker.close();
    this.worker = null;
  }
}
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import type { IJobRepository } from '@org/domain';
import { PinoLoggerService } from '@org/logger';
import { resolveStorageLocation, S3StorageService } from '@org/storage';
import {
  JOB_REPOSITORY_TOKEN,
  PostgresAdvisoryLockRunner,
} from '@org/persistence';

import {
  jobManagerCleanupConfig,
  jobManagerStorageConfig,
} from './app.config';

const EXPIRED_JOBS_CLEANUP_LOCK = {
  namespace: 'job-manager',
  resource: 'expired-jobs-cleanup',
} as const;

@Injectable()
export class ExpiredJobsCleanupService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleanupInFlight = false;
  private activeCleanupPromise: Promise<void> | null = null;

  constructor(
    @Inject(jobManagerCleanupConfig.KEY)
    private readonly cleanupConfig: ConfigType<typeof jobManagerCleanupConfig>,
    @Inject(jobManagerStorageConfig.KEY)
    private readonly storageConfig: ConfigType<typeof jobManagerStorageConfig>,
    @Inject(JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: IJobRepository,
    private readonly advisoryLockRunner: PostgresAdvisoryLockRunner,
    private readonly storageService: S3StorageService,
    private readonly logger: PinoLoggerService,
  ) {}

  onModuleInit(): void {
    void this.runCleanupTick();
    this.cleanupTimer = setInterval(() => {
      void this.runCleanupTick();
    }, this.cleanupConfig.intervalMinutes * 60_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    await this.activeCleanupPromise;
  }

  private async runCleanupTick(): Promise<void> {
    if (this.cleanupInFlight) {
      return;
    }

    this.cleanupInFlight = true;
    this.activeCleanupPromise = this.deleteExpiredJobs();

    try {
      await this.activeCleanupPromise;
    } finally {
      this.activeCleanupPromise = null;
      this.cleanupInFlight = false;
    }
  }

  private async deleteExpiredJobs(): Promise<void> {
    const result = await this.advisoryLockRunner.runWithLock(
      EXPIRED_JOBS_CLEANUP_LOCK,
      async () => {
        const expiredJobs = await this.jobRepository.findExpiredJobs(
          this.cleanupConfig.batchSize,
        );

        for (const job of expiredJobs) {
          try {
            const markExpiredResult = await this.jobRepository.markJobExpired(job.id);

            if (markExpiredResult.outcome === 'not_found') {
              continue;
            }

            if (job.resultPath) {
              await this.storageService.deleteObject(
                resolveStorageLocation(
                  job.resultPath,
                  this.storageConfig.defaultBucket,
                ),
              );
            }

            const deleted = await this.jobRepository.deleteJob(job.id);

            this.logger.log({
              event: deleted ? 'deleted expired job' : 'expired job already deleted',
              jobId: job.id,
              resultPath: job.resultPath,
            });
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown cleanup failure';

            this.logger.error({
              event: 'failed to cleanup expired job',
              jobId: job.id,
              resultPath: job.resultPath,
              errorMessage,
            });
          }
        }
      },
    );

    if (!result.acquired) {
      return;
    }
  }
}
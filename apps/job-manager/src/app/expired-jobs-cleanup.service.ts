import { setTimeout as delay } from 'node:timers/promises';
import { Cron } from '@nestjs/schedule';
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import type { IJobRepository } from '@org/domain';
import { PinoLoggerService } from '@org/logger';
import { resolveStorageLocation, S3StorageService } from '@org/storage';
import {
  JOB_REPOSITORY_TOKEN,
  RECOVERY_LEASE_STORE_TOKEN,
  type IRecoveryLeaseStore,
  type RecoveryLeaseHandle,
} from '@org/persistence';

import {
  getCleanupCronExpression,
  jobManagerCleanupConfig,
  jobManagerStorageConfig,
} from './app.config';

const CLEANUP_GLOBAL_LEASE_ID = 'cleanup:expired-jobs';

@Injectable()
export class ExpiredJobsCleanupService {
  constructor(
    @Inject(jobManagerCleanupConfig.KEY)
    private readonly cleanupConfig: ConfigType<typeof jobManagerCleanupConfig>,
    @Inject(jobManagerStorageConfig.KEY)
    private readonly storageConfig: ConfigType<typeof jobManagerStorageConfig>,
    @Inject(JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: IJobRepository,
    @Inject(RECOVERY_LEASE_STORE_TOKEN)
    private readonly recoveryLeaseStore: IRecoveryLeaseStore,
    private readonly storageService: S3StorageService,
    private readonly logger: PinoLoggerService,
  ) {}

  @Cron(getCleanupCronExpression())
  async deleteExpiredJobs(): Promise<void> {
    const globalLease = await this.recoveryLeaseStore.tryAcquireLease(
      CLEANUP_GLOBAL_LEASE_ID,
      this.cleanupConfig.leaseSeconds,
    );

    if (!globalLease) {
      return;
    }

    await this.runWithLeaseHeartbeat(globalLease, async () => {
      const expiredJobs = await this.jobRepository.findExpiredJobs(
        this.cleanupConfig.batchSize,
      );

      for (const job of expiredJobs) {
        const jobLease = await this.recoveryLeaseStore.tryAcquireLease(
          `cleanup:job:${job.id}`,
          this.cleanupConfig.leaseSeconds,
        );

        if (!jobLease) {
          continue;
        }

        try {
          await this.runWithLeaseHeartbeat(jobLease, async () => {
            if (job.resultPath) {
              await this.storageService.deleteObject(
                resolveStorageLocation(
                  job.resultPath,
                  this.storageConfig.defaultBucket,
                ),
              );
            }

            const deleted = await this.jobRepository.deleteJob(job.id);

            if (deleted) {
              this.logger.log({
                event: 'deleted expired job',
                jobId: job.id,
                resultPath: job.resultPath,
              });
            } else {
              this.logger.log({
                event: 'expired job already deleted',
                jobId: job.id,
                resultPath: job.resultPath,
              });
            }
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
    });
  }

  private async runWithLeaseHeartbeat<T>(
    lease: RecoveryLeaseHandle,
    work: () => Promise<T>,
  ): Promise<T> {
    const heartbeatIntervalMs = Math.max(
      1_000,
      Math.floor((this.cleanupConfig.leaseSeconds * 1_000) / 2),
    );
    let shouldStop = false;

    const heartbeatFailure = (async () => {
      let currentLease = lease;

      while (!shouldStop) {
        await delay(heartbeatIntervalMs);

        if (shouldStop) {
          return;
        }

        const extendedLease = await this.recoveryLeaseStore.extendLease(
          currentLease,
          this.cleanupConfig.leaseSeconds,
        );

        if (!extendedLease) {
          throw new Error(`lost recovery lease ${currentLease.id}`);
        }

        currentLease = extendedLease;
      }
    })();

    const workPromise = work();

    try {
      await Promise.race([workPromise.then(() => undefined), heartbeatFailure]);

      return await workPromise;
    } finally {
      shouldStop = true;

      try {
        await heartbeatFailure;
      } catch {
        // Ignore heartbeat errors here so the original cleanup failure wins.
      }

      await this.recoveryLeaseStore.releaseLease(lease);
    }
  }
}
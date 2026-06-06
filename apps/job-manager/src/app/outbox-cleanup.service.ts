import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { PinoLoggerService } from '@org/logger';
import {
  OUTBOX_MESSAGE_STORE_TOKEN,
  PostgresAdvisoryLockRunner,
  type IOutboxMessageStore,
} from '@org/persistence';

import { jobManagerOutboxConfig } from './app.config';

const OUTBOX_CLEANUP_LOCK = {
  namespace: 'job-manager',
  resource: 'outbox-cleanup',
} as const;

@Injectable()
export class OutboxCleanupService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleanupInFlight = false;
  private activeCleanupPromise: Promise<void> | null = null;

  constructor(
    @Inject(jobManagerOutboxConfig.KEY)
    private readonly outboxConfig: ConfigType<typeof jobManagerOutboxConfig>,
    @Inject(OUTBOX_MESSAGE_STORE_TOKEN)
    private readonly outboxStore: IOutboxMessageStore,
    private readonly advisoryLockRunner: PostgresAdvisoryLockRunner,
    private readonly logger: PinoLoggerService,
  ) {}

  onModuleInit(): void {
    void this.runCleanupTick();
    this.cleanupTimer = setInterval(() => {
      void this.runCleanupTick();
    }, this.outboxConfig.cleanupIntervalMs);
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
    this.activeCleanupPromise = this.cleanupExpiredOutboxMessages();

    try {
      await this.activeCleanupPromise;
    } finally {
      this.activeCleanupPromise = null;
      this.cleanupInFlight = false;
    }
  }

  private async cleanupExpiredOutboxMessages(): Promise<void> {
    const cutoff = new Date(Date.now() - this.outboxConfig.cleanupTtlMs);

    try {
      const result = await this.advisoryLockRunner.runWithLock(
        OUTBOX_CLEANUP_LOCK,
        () => this.outboxStore.deletePublishedBefore(cutoff),
      );

      if (!result.acquired) {
        return;
      }

      const deletedCount = result.value ?? 0;

      if (deletedCount > 0) {
        this.logger.log({
          event: 'cleaned up outbox records',
          deletedCount,
          cutoff: cutoff.toISOString(),
        });
      }
    } catch (error: unknown) {
      this.logger.error({
        event: 'failed to cleanup outbox records',
        cutoff: cutoff.toISOString(),
        errorMessage:
          error instanceof Error ? error.message : 'Unknown outbox cleanup failure',
      });
    }
  }
}
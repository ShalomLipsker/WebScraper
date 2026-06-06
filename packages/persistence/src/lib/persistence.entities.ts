import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { JobStatus } from '@org/domain';

@Index('idx_jobs_expires_at', ['expiresAt'])
@Entity({ name: 'jobs' })
export class JobEntity {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 128 })
  declare id: string;

  @Column({ name: 'url', type: 'text' })
  declare url: string;

  @Column({ name: 'status', type: 'varchar', length: 32 })
  declare status: JobStatus;

  @Column({ name: 'result_path', type: 'text', nullable: true })
  declare resultPath: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  declare errorMessage: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  declare expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  declare createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  declare updatedAt: Date;
}

@Index('idx_outbox_pending_dispatch', ['nextAttemptAt', 'createdAt'], {
  where: 'published_at IS NULL',
})
@Entity({ name: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 64 })
  declare id: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 128 })
  declare aggregateId: string;

  @Column({ name: 'message_id', type: 'varchar', length: 128 })
  declare messageId: string;

  @Column({ name: 'queue_name', type: 'varchar', length: 255 })
  declare queueName: string;

  @Column({ name: 'message_name', type: 'varchar', length: 255, nullable: true })
  declare messageName: string | null;

  @Column({ name: 'payload', type: 'jsonb' })
  declare payload: unknown;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  declare attemptCount: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  declare publishedAt: Date | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  declare nextAttemptAt: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  declare lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  declare createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  declare updatedAt: Date;
}

@Entity({ name: 'job_maintenance_leases' })
export class JobMaintenanceLeaseEntity {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 128 })
  declare id: string;

  @Column({ name: 'owner_id', type: 'varchar', length: 128 })
  declare ownerId: string;

  @Column({ name: 'leased_until', type: 'timestamptz' })
  declare leasedUntil: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  declare updatedAt: Date;
}
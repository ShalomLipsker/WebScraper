import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { JobStatus } from '@org/domain';

@Entity({ name: 'jobs' })
export class JobEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  declare id: string;

  @Column({ type: 'text' })
  declare url: string;

  @Column({ type: 'varchar', length: 32 })
  declare status: JobStatus;

  @Column({ type: 'text', nullable: true })
  declare resultPath: string | null;

  @Column({ type: 'text', nullable: true })
  declare errorMessage: string | null;

  @Column({ type: 'timestamptz' })
  declare expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  declare createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  declare updatedAt: Date;
}

@Entity({ name: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  declare id: string;

  @Column({ type: 'varchar', length: 128 })
  declare aggregateId: string;

  @Column({ type: 'varchar', length: 128 })
  declare messageId: string;

  @Column({ type: 'varchar', length: 255 })
  declare queueName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  declare messageName: string | null;

  @Column({ type: 'jsonb' })
  declare payload: unknown;

  @Column({ type: 'integer', default: 0 })
  declare attemptCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  declare publishedAt: Date | null;

  @Column({ type: 'timestamptz' })
  declare nextAttemptAt: Date;

  @Column({ type: 'text', nullable: true })
  declare lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  declare createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  declare updatedAt: Date;
}

@Entity({ name: 'job_maintenance_leases' })
export class JobMaintenanceLeaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  declare id: string;

  @Column({ type: 'varchar', length: 128 })
  declare ownerId: string;

  @Column({ type: 'timestamptz' })
  declare leasedUntil: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  declare updatedAt: Date;
}
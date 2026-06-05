import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLoggerService } from '@org/logger';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { JobMaintenanceLeaseEntity } from './persistence.entities.js';
import type {
  IRecoveryLeaseStore,
  RecoveryLeaseHandle,
} from './recovery-lease.types.js';

type LeaseRow = {
  id: string;
  owner_id: string;
  leased_until: Date | string;
};

@Injectable()
export class PostgresRecoveryLeaseStore implements IRecoveryLeaseStore {
  constructor(
    @InjectRepository(JobMaintenanceLeaseEntity)
    private readonly leasesRepository: Repository<JobMaintenanceLeaseEntity>,
    @Optional()
    private readonly logger?: PinoLoggerService,
  ) {}

  async tryAcquireLease(
    id: string,
    leaseTtlSeconds: number,
  ): Promise<RecoveryLeaseHandle | null> {
    const ownerId = randomUUID();
    const leasedUntil = new Date(Date.now() + leaseTtlSeconds * 1000);
    const result = await this.leasesRepository.query(
      `
        INSERT INTO job_maintenance_leases (id, owner_id, leased_until, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          leased_until = EXCLUDED.leased_until,
          updated_at = NOW()
        WHERE job_maintenance_leases.leased_until <= NOW()
        RETURNING id, owner_id, leased_until
      `,
      [id, ownerId, leasedUntil],
    );

    const [leaseRow] = result as LeaseRow[];

    this.logger?.log({
      event: leaseRow ? 'acquired recovery lease' : 'skipped recovery lease acquisition',
      leaseId: id,
      leaseTtlSeconds,
      outcome: leaseRow ? 'acquired' : 'busy',
    });

    return leaseRow ? toRecoveryLeaseHandle(leaseRow) : null;
  }

  async extendLease(
    lease: RecoveryLeaseHandle,
    leaseTtlSeconds: number,
  ): Promise<RecoveryLeaseHandle | null> {
    const leasedUntil = new Date(Date.now() + leaseTtlSeconds * 1000);
    const result = await this.leasesRepository.query(
      `
        UPDATE job_maintenance_leases
        SET leased_until = $3,
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND leased_until > NOW()
        RETURNING id, owner_id, leased_until
      `,
      [lease.id, lease.ownerId, leasedUntil],
    );

    const [leaseRow] = result as LeaseRow[];

    this.logger?.log({
      event: leaseRow ? 'extended recovery lease' : 'failed to extend recovery lease',
      leaseId: lease.id,
      leaseTtlSeconds,
      outcome: leaseRow ? 'extended' : 'expired',
    });

    return leaseRow ? toRecoveryLeaseHandle(leaseRow) : null;
  }

  async releaseLease(lease: RecoveryLeaseHandle): Promise<void> {
    await this.leasesRepository.query(
      `
        DELETE FROM job_maintenance_leases
        WHERE id = $1
          AND owner_id = $2
      `,
      [lease.id, lease.ownerId],
    );

    this.logger?.log({
      event: 'released recovery lease',
      leaseId: lease.id,
      outcome: 'released',
    });
  }
}

function toRecoveryLeaseHandle(row: LeaseRow): RecoveryLeaseHandle {
  return {
    id: row.id,
    ownerId: row.owner_id,
    leasedUntil: new Date(row.leased_until),
  };
}
export interface RecoveryLeaseHandle {
  id: string;
  ownerId: string;
  leasedUntil: Date;
}

export interface IRecoveryLeaseStore {
  tryAcquireLease(
    id: string,
    leaseTtlSeconds: number,
  ): Promise<RecoveryLeaseHandle | null>;
  extendLease(
    lease: RecoveryLeaseHandle,
    leaseTtlSeconds: number,
  ): Promise<RecoveryLeaseHandle | null>;
  releaseLease(lease: RecoveryLeaseHandle): Promise<void>;
}
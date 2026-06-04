export const JOB_STATUSES = [
  'SUBMITTED',
  'ENQUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobId = string;

export interface JobMetadata {
  id: JobId;
  url: string;
  status: JobStatus;
  minioPath?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateJobInput = Omit<JobMetadata, 'createdAt' | 'updatedAt'>;

export type JobMetadataPatch = Partial<
  Omit<JobMetadata, 'id' | 'url' | 'createdAt' | 'updatedAt'>
>;

export interface IJobRepository {
  getJob(id: JobId): Promise<JobMetadata | null>;
  createJob(job: CreateJobInput): Promise<JobMetadata>;
  createJobIfNotExists(job: CreateJobInput): Promise<{ job: JobMetadata; alreadyExisted: boolean }>;
  tryAcquireRecoveryLease(id: JobId, leaseTtlSeconds: number): Promise<boolean>;
  updateJobStatus(
    id: JobId,
    status: JobStatus,
    extra?: JobMetadataPatch,
  ): Promise<void>;
}
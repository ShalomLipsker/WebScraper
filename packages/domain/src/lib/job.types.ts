export const JOB_STATUSES = [
  'PENDING',
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
  updateJobStatus(
    id: JobId,
    status: JobStatus,
    extra?: JobMetadataPatch,
  ): Promise<void>;
}
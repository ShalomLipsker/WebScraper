import type { JobMetadata } from '@org/domain';

import { JobEntity } from './persistence.entities.js';

type JobRow = JobEntity & {
  result_path?: string | null;
  error_message?: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
};

export function toJobMetadata(job: JobEntity): JobMetadata {
  const rawJob = job as JobRow;

  return {
    id: job.id,
    url: job.url,
    status: job.status,
    resultPath: job.resultPath ?? rawJob.result_path ?? undefined,
    errorMessage: job.errorMessage ?? rawJob.error_message ?? undefined,
    createdAt: new Date(job.createdAt ?? rawJob.created_at ?? new Date()),
    updatedAt: new Date(job.updatedAt ?? rawJob.updated_at ?? new Date()),
  };
}
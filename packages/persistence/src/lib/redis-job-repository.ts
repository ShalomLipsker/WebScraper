import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateJobInput,
  IJobRepository,
  JobMetadata,
  JobMetadataPatch,
  JobStatus,
} from '@org/domain';
import { type Redis } from 'ioredis';

import {
  DEFAULT_REDIS_JOB_KEY_PREFIX,
  DEFAULT_REDIS_JOB_TTL_SECONDS,
  REDIS_CLIENT_TOKEN,
  REDIS_PERSISTENCE_OPTIONS_TOKEN,
} from './persistence.constants.js';
import type { RedisPersistenceModuleOptions } from './persistence.types.js';

interface StoredJobRecord
  extends Omit<JobMetadata, 'createdAt' | 'updatedAt'> {
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class RedisJobRepository implements IJobRepository {
  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    @Inject(REDIS_PERSISTENCE_OPTIONS_TOKEN)
    private readonly options: RedisPersistenceModuleOptions,
  ) { }

  async getJob(id: string): Promise<JobMetadata | null> {
    const record = await this.redis.get(this.getKey(id));

    if (!record) {
      return null;
    }

    return deserializeJob(record);
  }

  async createJob(job: CreateJobInput): Promise<JobMetadata> {
    const now = new Date();
    const metadata: JobMetadata = {
      ...job,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeJob(metadata);

    return metadata;
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    extra: JobMetadataPatch = {},
  ): Promise<void> {
    // TODO: This method is not atomic, and not safe to use in a concurrent environment. 
    // Now we assume that there will be only one process updating the status of a job,
    // but in the future we might want to add some optimistic locking mechanism here.
    const existingJob = await this.getJob(id);

    if (!existingJob) {
      throw new Error(`Job ${id} was not found`);
    }

    const { status: _ignoredStatus, ...rest } = extra;
    const updatedJob: JobMetadata = {
      ...existingJob,
      ...removeUndefinedProperties(rest),
      status,
      updatedAt: new Date(),
    };

    await this.writeJob(updatedJob);
  }

  private getKey(id: string): string {
    return `${this.options.keyPrefix ?? DEFAULT_REDIS_JOB_KEY_PREFIX}${id}`;
  }

  private async writeJob(job: JobMetadata): Promise<void> {
    const ttlSeconds = this.options.ttlSeconds ?? DEFAULT_REDIS_JOB_TTL_SECONDS;
    const payload = serializeJob(job);
    const key = this.getKey(job.id);

    if (ttlSeconds > 0) {
      await this.redis.set(key, payload, 'EX', ttlSeconds);
      return;
    }

    await this.redis.set(key, payload);
  }
}

function serializeJob(job: JobMetadata): string {
  const payload: StoredJobRecord = {
    ...job,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };

  return JSON.stringify(payload);
}

function deserializeJob(payload: string): JobMetadata {
  const record = JSON.parse(payload) as StoredJobRecord;

  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function removeUndefinedProperties(
  patch: JobMetadataPatch,
): Partial<JobMetadataPatch> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
}
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { JobMetadata } from '@org/domain';
import { DataSource } from 'typeorm';

import {
  DEFAULT_JOB_RETENTION_SECONDS,
  POSTGRES_PERSISTENCE_OPTIONS_TOKEN,
} from './persistence.constants.js';
import { JobEntity, OutboxMessageEntity } from './persistence.entities.js';
import type {
  CreateJobSubmissionInput,
  IJobSubmissionStore,
  PostgresPersistenceModuleOptions,
} from './persistence.types.js';

@Injectable()
export class PostgresJobSubmissionStore implements IJobSubmissionStore {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(POSTGRES_PERSISTENCE_OPTIONS_TOKEN)
    private readonly options: PostgresPersistenceModuleOptions,
  ) {}

  async createJobSubmissionIfNotExists<TPayload>(
    input: CreateJobSubmissionInput<TPayload>,
  ): Promise<{ job: JobMetadata; alreadyExisted: boolean }> {
    return this.dataSource.transaction(async (entityManager) => {
      const jobsRepository = entityManager.getRepository(JobEntity);
      const outboxRepository = entityManager.getRepository(OutboxMessageEntity);
      const insertResult = await jobsRepository
        .createQueryBuilder()
        .insert()
        .into(JobEntity)
        .values({
          id: input.job.id,
          url: input.job.url,
          status: input.job.status,
          resultPath: input.job.resultPath ?? null,
          errorMessage: input.job.errorMessage ?? null,
          expiresAt: createExpirationDate(this.options),
        })
        .orIgnore()
        .returning('*')
        .execute();

      if (insertResult.raw.length === 0) {
        const existingJob = await jobsRepository.findOneOrFail({
          where: { id: input.job.id },
        });

        return {
          job: toJobMetadata(existingJob),
          alreadyExisted: true,
        };
      }

      await outboxRepository.save(
        outboxRepository.create({
          id: randomUUID(),
          aggregateId: input.job.id,
          messageId: input.message.id,
          queueName: input.queueName,
          messageName: input.message.name ?? null,
          payload: input.message.data,
          nextAttemptAt: new Date(),
          publishedAt: null,
          attemptCount: 0,
          lastError: null,
        }),
      );

      return {
        job: toJobMetadata(insertResult.raw[0] as JobEntity),
        alreadyExisted: false,
      };
    });
  }
}

function createExpirationDate(
  options: PostgresPersistenceModuleOptions,
): Date {
  const retentionSeconds =
    options.jobRetentionSeconds ?? DEFAULT_JOB_RETENTION_SECONDS;

  return new Date(Date.now() + retentionSeconds * 1000);
}

function toJobMetadata(job: JobEntity): JobMetadata {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    resultPath: job.resultPath ?? undefined,
    errorMessage: job.errorMessage ?? undefined,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
  };
}
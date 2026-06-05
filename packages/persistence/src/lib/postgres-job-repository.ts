import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CreateJobInput,
  IJobRepository,
  JobMetadata,
  JobMetadataPatch,
  JobStatus,
  UpdateJobStatusResult,
} from '@org/domain';
import { PinoLoggerService } from '@org/logger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  DEFAULT_JOB_RETENTION_SECONDS,
  POSTGRES_PERSISTENCE_OPTIONS_TOKEN,
} from './persistence.constants.js';
import { JobEntity, JobMaintenanceLeaseEntity } from './persistence.entities.js';
import type { PostgresPersistenceModuleOptions } from './persistence.types.js';

@Injectable()
export class PostgresJobRepository implements IJobRepository {
  constructor(
    @InjectRepository(JobEntity)
    private readonly jobsRepository: Repository<JobEntity>,
    @Inject(POSTGRES_PERSISTENCE_OPTIONS_TOKEN)
    private readonly options: PostgresPersistenceModuleOptions,
    @Optional()
    private readonly logger?: PinoLoggerService,
  ) {}

  async getJob(id: string): Promise<JobMetadata | null> {
    const job = await this.jobsRepository.findOne({ where: { id } });

    return job ? toJobMetadata(job) : null;
  }

  async findExpiredJobs(limit: number): Promise<JobMetadata[]> {
    const jobs = await this.jobsRepository
      .createQueryBuilder('job')
      .where('job.expiresAt <= NOW()')
      .orderBy('job.expiresAt', 'ASC')
      .limit(limit)
      .getMany();

    if (jobs.length > 0) {
      this.logger?.log({
        event: 'loaded expired jobs',
        jobCount: jobs.length,
      });
    }

    return jobs.map((job) => toJobMetadata(job));
  }

  async createJob(job: CreateJobInput): Promise<JobMetadata> {
    const entity = this.jobsRepository.create({
      id: job.id,
      url: job.url,
      status: job.status,
      resultPath: job.resultPath ?? null,
      errorMessage: job.errorMessage ?? null,
      expiresAt: this.createExpirationDate(),
    });

    const savedJob = await this.jobsRepository.save(entity);

    this.logger?.log({
      event: 'created job record',
      jobId: savedJob.id,
      status: savedJob.status,
      outcome: 'created',
    });

    return toJobMetadata(savedJob);
  }

  async createJobIfNotExists(
    job: CreateJobInput,
  ): Promise<{ job: JobMetadata; alreadyExisted: boolean }> {
    const insertResult = await this.jobsRepository
      .createQueryBuilder()
      .insert()
      .into(JobEntity)
      .values({
        id: job.id,
        url: job.url,
        status: job.status,
        resultPath: job.resultPath ?? null,
        errorMessage: job.errorMessage ?? null,
        expiresAt: this.createExpirationDate(),
      })
      .orIgnore()
      .returning('*')
      .execute();

    if (insertResult.raw.length > 0) {
      const createdJob = toJobMetadata(insertResult.raw[0] as JobEntity);

      this.logger?.log({
        event: 'created job record',
        jobId: createdJob.id,
        status: createdJob.status,
        outcome: 'created',
      });

      return {
        job: createdJob,
        alreadyExisted: false,
      };
    }

    const existingJob = await this.jobsRepository.findOneOrFail({
      where: { id: job.id },
    });

    this.logger?.log({
      event: 'reused existing job record',
      jobId: existingJob.id,
      status: existingJob.status,
      outcome: 'already_exists',
    });

    return {
      job: toJobMetadata(existingJob),
      alreadyExisted: true,
    };
  }

  async deleteJob(id: string): Promise<boolean> {
    const deleted = await this.jobsRepository.manager.transaction(async (entityManager) => {
      const jobsRepository = entityManager.getRepository(JobEntity);
      const leasesRepository = entityManager.getRepository(JobMaintenanceLeaseEntity);

      const deleteResult = await jobsRepository.delete({ id });
      await leasesRepository.delete([
        { id },
        { id: `cleanup:job:${id}` },
      ]);

      return (deleteResult.affected ?? 0) > 0;
    });

    this.logger?.log({
      event: deleted ? 'deleted job record' : 'job record already missing',
      jobId: id,
      outcome: deleted ? 'deleted' : 'missing',
    });

    return deleted;
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    extra: JobMetadataPatch = {},
  ): Promise<UpdateJobStatusResult> {
    const guard = createStatusGuard(status);
    const updateResult = await this.jobsRepository
      .createQueryBuilder()
      .update(JobEntity)
      .set({
        status,
        resultPath:
          extra.resultPath !== undefined
            ? extra.resultPath ?? null
            : undefined,
        errorMessage:
          extra.errorMessage !== undefined
            ? extra.errorMessage ?? null
            : undefined,
        expiresAt: this.createExpirationDate(),
      })
      .returning('*')
      .where('id = :id', { id })
      .andWhere(guard.clause, guard.parameters)
      .execute();

    if (updateResult.raw.length > 0) {
      const updatedJob = toJobMetadata(updateResult.raw[0] as JobEntity);

      this.logger?.log({
        event: 'updated job status',
        jobId: updatedJob.id,
        status,
        outcome: 'updated',
      });

      return {
        outcome: 'updated',
        job: updatedJob,
      };
    }

    const existingJob = await this.jobsRepository.findOne({ where: { id } });

    if (!existingJob) {
      this.logger?.warn({
        event: 'failed to update missing job status',
        jobId: id,
        status,
        outcome: 'not_found',
      });

      return {
        outcome: 'not_found',
        job: null,
      };
    }

    this.logger?.warn({
      event: 'blocked job status transition',
      jobId: id,
      status,
      persistedStatus: existingJob.status,
      outcome: 'blocked',
    });

    return {
      outcome: 'blocked',
      job: toJobMetadata(existingJob),
    };
  }

  private createExpirationDate(): Date {
    const retentionSeconds =
      this.options.jobRetentionSeconds ?? DEFAULT_JOB_RETENTION_SECONDS;

    return new Date(Date.now() + retentionSeconds * 1000);
  }
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

function createStatusGuard(status: JobStatus): {
  clause: string;
  parameters: Record<string, string[]>;
} {
  switch (status) {
    case 'SUBMITTED':
      return {
        clause: 'status = :submittedStatus',
        parameters: { submittedStatus: ['SUBMITTED'] as unknown as string[] },
      };
    case 'ENQUEUED':
      return {
        clause: 'status IN (:...allowedStatuses)',
        parameters: { allowedStatuses: ['SUBMITTED', 'ENQUEUED'] },
      };
    case 'PROCESSING':
      return {
        clause: 'status IN (:...allowedStatuses)',
        parameters: { allowedStatuses: ['SUBMITTED', 'ENQUEUED', 'PROCESSING'] },
      };
    case 'COMPLETED':
    case 'FAILED':
      return {
        clause: '(status NOT IN (:...terminalStatuses) OR status = :targetStatus)',
        parameters: {
          terminalStatuses: ['COMPLETED', 'FAILED'],
          targetStatus: [status] as unknown as string[],
        },
      };
  }
}
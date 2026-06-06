import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface PostgresAdvisoryLockKey {
  namespace: string;
  resource: string;
}

export interface PostgresAdvisoryLockResult<T> {
  acquired: boolean;
  value?: T;
}

@Injectable()
export class PostgresAdvisoryLockRunner {
  constructor(private readonly dataSource: DataSource) {}

  runWithLock<T>(
    key: PostgresAdvisoryLockKey,
    work: () => Promise<T>,
  ): Promise<PostgresAdvisoryLockResult<T>> {
    return runWithPostgresAdvisoryLock(this.dataSource, key, work);
  }
}

export async function runWithPostgresAdvisoryLock<T>(
  dataSource: DataSource,
  key: PostgresAdvisoryLockKey,
  work: () => Promise<T>,
): Promise<PostgresAdvisoryLockResult<T>> {
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();

  try {
    const rawResult = await queryRunner.query(
      `
        SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired
      `,
      [key.namespace, key.resource],
    );

    const [row] = Array.isArray(rawResult[0]) ? rawResult[0] : rawResult;
    const acquired = row?.acquired === true || row?.acquired === 't';

    if (!acquired) {
      return { acquired: false };
    }

    try {
      return {
        acquired: true,
        value: await work(),
      };
    } finally {
      await queryRunner.query(
        `
          SELECT pg_advisory_unlock(hashtext($1), hashtext($2))
        `,
        [key.namespace, key.resource],
      );
    }
  } finally {
    await queryRunner.release();
  }
}
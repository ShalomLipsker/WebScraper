import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresAdvisoryLockRunner,
  runWithPostgresAdvisoryLock,
} from '../src/lib/postgres-advisory-lock.js';
import { createPostgresTestContext, type PostgresTestContext } from './postgres-test.utils.js';

describe('PostgresAdvisoryLockRunner integration', { concurrent: false }, () => {
  let context: PostgresTestContext;
  let runner: PostgresAdvisoryLockRunner;

  beforeAll(async () => {
    context = await createPostgresTestContext({
      label: 'advisory_lock',
      synchronize: false,
    });
    runner = new PostgresAdvisoryLockRunner(context.dataSource);
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('runWithLock acquires the lock and returns the work result', async () => {
    await expect(
      runner.runWithLock(
        { namespace: 'locks', resource: 'acquire-result' },
        async () => 'locked-value',
      ),
    ).resolves.toEqual({
      acquired: true,
      value: 'locked-value',
    });
  });

  it('runWithPostgresAdvisoryLock returns acquired false when the lock is already held', async () => {
    const queryRunner = context.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(
      `SELECT pg_advisory_lock(hashtext($1), hashtext($2))`,
      ['locks', 'held-elsewhere'],
    );

    try {
      await expect(
        runWithPostgresAdvisoryLock(
          context.dataSource,
          { namespace: 'locks', resource: 'held-elsewhere' },
          async () => 'should-not-run',
        ),
      ).resolves.toEqual({ acquired: false });
    } finally {
      await queryRunner.query(
        `SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`,
        ['locks', 'held-elsewhere'],
      );
      await queryRunner.release();
    }
  });

  it('runWithPostgresAdvisoryLock releases the lock after successful work', async () => {
    await runWithPostgresAdvisoryLock(
      context.dataSource,
      { namespace: 'locks', resource: 'release-success' },
      async () => 'first-pass',
    );

    await expect(
      runWithPostgresAdvisoryLock(
        context.dataSource,
        { namespace: 'locks', resource: 'release-success' },
        async () => 'second-pass',
      ),
    ).resolves.toEqual({
      acquired: true,
      value: 'second-pass',
    });
  });

  it('runWithPostgresAdvisoryLock releases the lock when work throws', async () => {
    await expect(
      runWithPostgresAdvisoryLock(
        context.dataSource,
        { namespace: 'locks', resource: 'release-error' },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    await expect(
      runWithPostgresAdvisoryLock(
        context.dataSource,
        { namespace: 'locks', resource: 'release-error' },
        async () => 'recovered',
      ),
    ).resolves.toEqual({
      acquired: true,
      value: 'recovered',
    });
  });
});
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource, type EntityTarget } from 'typeorm';

const POSTGRES_URL =
  process.env.POSTGRES_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/webscraper';

export interface PostgresTestContext {
  dataSource: DataSource;
  schema: string;
  reset: () => Promise<void>;
  cleanup: () => Promise<void>;
}

interface CreatePostgresTestContextOptions {
  label: string;
  entities?: Array<EntityTarget<object>>;
  synchronize?: boolean;
}

export async function createPostgresTestContext(
  options: CreatePostgresTestContextOptions,
): Promise<PostgresTestContext> {
  const schema = createSchemaName(options.label);
  const adminDataSource = new DataSource({
    type: 'postgres',
    url: POSTGRES_URL,
    logging: false,
  });

  await adminDataSource.initialize();
  await adminDataSource.query(`CREATE SCHEMA "${schema}"`);

  const dataSource = new DataSource({
    type: 'postgres',
    url: POSTGRES_URL,
    schema,
    logging: false,
    synchronize: options.synchronize ?? true,
    entities: options.entities ?? [],
  });

  await dataSource.initialize();

  return {
    dataSource,
    schema,
    reset: async () => {
      await truncateSchemaTables(adminDataSource, schema);
    },
    cleanup: async () => {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }

      if (adminDataSource.isInitialized) {
        await adminDataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await adminDataSource.destroy();
      }
    },
  };
}

function createSchemaName(label: string): string {
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

  return `test_${sanitizedLabel}_${randomUUID().replace(/-/g, '')}`;
}

async function truncateSchemaTables(
  dataSource: DataSource,
  schema: string,
): Promise<void> {
  const tables = await dataSource.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `,
    [schema],
  ) as Array<{ table_name: string }>;

  if (tables.length === 0) {
    return;
  }

  const tableList = tables
    .map((table) => `"${schema}"."${table.table_name}"`)
    .join(', ');

  await dataSource.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}
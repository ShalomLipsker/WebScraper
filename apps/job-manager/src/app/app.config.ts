import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import {
  parseOptionalBooleanEnv,
  readBooleanEnv,
  readNumberEnv,
  readScrapeMessagingConfig,
  type ScrapeMessagingConfig,
} from '@org/domain';
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';
type JobManagerNodeEnv = 'development' | 'production' | 'test';

export interface JobManagerHttpConfig {
  port: number;
}

export interface JobManagerServiceConfig {
  serviceName: 'job-manager';
  nodeEnv: JobManagerNodeEnv;
  logLevel: string;
  http: JobManagerHttpConfig;
}

export interface JobManagerTransportConfig {
  host: string;
  tcpPort: number;
}

export interface JobManagerPersistenceConfig {
  url?: string;
  synchronize: boolean;
  jobRetentionSeconds: number;
}

export interface JobManagerStorageConfig {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  defaultBucket?: string;
}

export interface JobManagerRabbitMqConfig {
  url?: string;
  jobQueueDeduplicationEnabled: boolean;
}

export interface JobManagerOutboxConfig {
  pollIntervalMs: number;
  batchSize: number;
}

export interface JobManagerCleanupConfig {
  intervalMinutes: number;
  batchSize: number;
  leaseSeconds: number;
}

class EnvironmentVariables {
  @IsEnum(['development', 'production', 'test'])
  @IsOptional()
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  LOG_LEVEL: string = 'info';

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  PORT: number = 3001;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  JOB_MANAGER_HOST: string = '127.0.0.1';

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  JOB_MANAGER_TCP_PORT: number = 4001;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  SCRAPE_JOB_QUEUE_NAME?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  SCRAPE_STATUS_QUEUE_NAME?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  SCRAPE_JOB_PATTERN?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  SCRAPE_JOB_STATUS_PATTERN?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  POSTGRES_URL?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  JOB_RETENTION_SECONDS: number = 86_400;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => parseOptionalBooleanEnv(value))
  POSTGRES_SYNCHRONIZE: boolean = true;

  @IsInt()
  @Min(100)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  OUTBOX_POLL_INTERVAL_MS: number = 1_000;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  OUTBOX_BATCH_SIZE: number = 50;

  @IsInt()
  @Min(1)
  @Max(59)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  JOB_CLEANUP_INTERVAL_MINUTES: number = 1;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  JOB_CLEANUP_BATCH_SIZE: number = 100;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  JOB_CLEANUP_LEASE_SECONDS: number = 60;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  S3_REGION: string = 'us-east-1';

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  S3_ENDPOINT?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => parseOptionalBooleanEnv(value))
  S3_FORCE_PATH_STYLE: boolean = true;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  S3_ACCESS_KEY_ID?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  S3_SECRET_ACCESS_KEY?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  S3_DEFAULT_BUCKET?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  RABBITMQ_URL?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => parseOptionalBooleanEnv(value))
  RABBITMQ_JOB_QUEUE_DEDUPLICATION_ENABLED: boolean = true;
}

function validateEnvironmentVariables(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const validatedConfig = plainToInstance(EnvironmentVariables, env);
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Config validation error: ${errors.toString()}`);
  }

  return {
    ...env,
    NODE_ENV: validatedConfig.NODE_ENV,
    LOG_LEVEL: validatedConfig.LOG_LEVEL,
    PORT: String(validatedConfig.PORT),
    JOB_MANAGER_HOST: validatedConfig.JOB_MANAGER_HOST,
    JOB_MANAGER_TCP_PORT: String(validatedConfig.JOB_MANAGER_TCP_PORT),
    SCRAPE_JOB_QUEUE_NAME: validatedConfig.SCRAPE_JOB_QUEUE_NAME,
    SCRAPE_STATUS_QUEUE_NAME: validatedConfig.SCRAPE_STATUS_QUEUE_NAME,
    SCRAPE_JOB_PATTERN: validatedConfig.SCRAPE_JOB_PATTERN,
    SCRAPE_JOB_STATUS_PATTERN: validatedConfig.SCRAPE_JOB_STATUS_PATTERN,
    POSTGRES_URL: validatedConfig.POSTGRES_URL,
    JOB_RETENTION_SECONDS: String(validatedConfig.JOB_RETENTION_SECONDS),
    POSTGRES_SYNCHRONIZE: String(validatedConfig.POSTGRES_SYNCHRONIZE),
    OUTBOX_POLL_INTERVAL_MS: String(validatedConfig.OUTBOX_POLL_INTERVAL_MS),
    OUTBOX_BATCH_SIZE: String(validatedConfig.OUTBOX_BATCH_SIZE),
    JOB_CLEANUP_INTERVAL_MINUTES: String(
      validatedConfig.JOB_CLEANUP_INTERVAL_MINUTES,
    ),
    JOB_CLEANUP_BATCH_SIZE: String(validatedConfig.JOB_CLEANUP_BATCH_SIZE),
    JOB_CLEANUP_LEASE_SECONDS: String(validatedConfig.JOB_CLEANUP_LEASE_SECONDS),
    S3_REGION: validatedConfig.S3_REGION,
    S3_ENDPOINT: validatedConfig.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: String(validatedConfig.S3_FORCE_PATH_STYLE),
    S3_ACCESS_KEY_ID: validatedConfig.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: validatedConfig.S3_SECRET_ACCESS_KEY,
    S3_DEFAULT_BUCKET: validatedConfig.S3_DEFAULT_BUCKET,
    RABBITMQ_URL: validatedConfig.RABBITMQ_URL,
    RABBITMQ_JOB_QUEUE_DEDUPLICATION_ENABLED: String(
      validatedConfig.RABBITMQ_JOB_QUEUE_DEDUPLICATION_ENABLED,
    ),
  };
}

function readServiceConfig(): JobManagerServiceConfig {
  return {
    serviceName: 'job-manager',
    nodeEnv: (process.env.NODE_ENV as JobManagerNodeEnv) || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
      port: Number(process.env.PORT),
    },
  };
}

function readTransportConfig(): JobManagerTransportConfig {
  return {
    host: process.env.JOB_MANAGER_HOST || '127.0.0.1',
    tcpPort: Number(process.env.JOB_MANAGER_TCP_PORT),
  };
}

function readMessagingConfig(): ScrapeMessagingConfig {
  return readScrapeMessagingConfig(process.env);
}

function readPersistenceConfig(): JobManagerPersistenceConfig {
  return {
    url: process.env.POSTGRES_URL || undefined,
    synchronize: readBooleanEnv(process.env.POSTGRES_SYNCHRONIZE, true),
    jobRetentionSeconds: Number(process.env.JOB_RETENTION_SECONDS),
  };
}

function readStorageConfig(): JobManagerStorageConfig {
  return {
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: readBooleanEnv(process.env.S3_FORCE_PATH_STYLE, true),
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    defaultBucket: process.env.S3_DEFAULT_BUCKET || undefined,
  };
}

function readRabbitMqConfig(): JobManagerRabbitMqConfig {
  return {
    url: process.env.RABBITMQ_URL || undefined,
    jobQueueDeduplicationEnabled: readBooleanEnv(
      process.env.RABBITMQ_JOB_QUEUE_DEDUPLICATION_ENABLED,
      false,
    ),
  };
}

function readOutboxConfig(): JobManagerOutboxConfig {
  return {
    pollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS),
    batchSize: Number(process.env.OUTBOX_BATCH_SIZE),
  };
}

function readCleanupConfig(): JobManagerCleanupConfig {
  return {
    intervalMinutes: readNumberEnv(process.env.JOB_CLEANUP_INTERVAL_MINUTES, 1),
    batchSize: readNumberEnv(process.env.JOB_CLEANUP_BATCH_SIZE, 100),
    leaseSeconds: readNumberEnv(process.env.JOB_CLEANUP_LEASE_SECONDS, 60),
  };
}

export function getCleanupCronExpression(): string {
  return `0 */${readCleanupConfig().intervalMinutes} * * * *`;
}

export const jobManagerServiceConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.service`,
  (): JobManagerServiceConfig => readServiceConfig(),
);

export const jobManagerTransportConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.transport`,
  (): JobManagerTransportConfig => readTransportConfig(),
);

export const jobManagerMessagingConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.messaging`,
  (): ScrapeMessagingConfig => readMessagingConfig(),
);

export const jobManagerPersistenceConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.persistence`,
  (): JobManagerPersistenceConfig => readPersistenceConfig(),
);

export const jobManagerStorageConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.storage`,
  (): JobManagerStorageConfig => readStorageConfig(),
);

export const jobManagerRabbitMqConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.rabbitMq`,
  (): JobManagerRabbitMqConfig => readRabbitMqConfig(),
);

export const jobManagerOutboxConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.outbox`,
  (): JobManagerOutboxConfig => readOutboxConfig(),
);

export const jobManagerCleanupConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.cleanup`,
  (): JobManagerCleanupConfig => readCleanupConfig(),
);

export const jobManagerMessagingBindings = readMessagingConfig();

export const jobManagerConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [
    jobManagerServiceConfig,
    jobManagerTransportConfig,
    jobManagerMessagingConfig,
    jobManagerPersistenceConfig,
    jobManagerStorageConfig,
    jobManagerRabbitMqConfig,
    jobManagerOutboxConfig,
    jobManagerCleanupConfig,
  ],
});

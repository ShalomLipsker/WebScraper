import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { readScrapeMessagingConfig, type ScrapeMessagingConfig } from '@org/domain';
import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

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

export interface JobManagerRecoveryConfig {
  submittedDelayMs: number;
  submittedLeaseSeconds: number;
}

export interface JobManagerRedisConfig {
  url?: string;
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

  @IsInt()
  @Min(0)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SUBMITTED_RECOVERY_DELAY_MS: number = 10_000;

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

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SUBMITTED_RECOVERY_LEASE_SECONDS: number = 30;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  REDIS_URL?: string;
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
    SUBMITTED_RECOVERY_DELAY_MS: String(validatedConfig.SUBMITTED_RECOVERY_DELAY_MS),
    SUBMITTED_RECOVERY_LEASE_SECONDS: String(validatedConfig.SUBMITTED_RECOVERY_LEASE_SECONDS),
    REDIS_URL: validatedConfig.REDIS_URL,
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

function readRecoveryConfig(): JobManagerRecoveryConfig {
  return {
    submittedDelayMs: Number(process.env.SUBMITTED_RECOVERY_DELAY_MS),
    submittedLeaseSeconds: Number(process.env.SUBMITTED_RECOVERY_LEASE_SECONDS),
  };
}

function readRedisConfig(): JobManagerRedisConfig {
  return {
    url: process.env.REDIS_URL || undefined,
  };
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

export const jobManagerRecoveryConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.recovery`,
  (): JobManagerRecoveryConfig => readRecoveryConfig(),
);

export const jobManagerRedisConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.redis`,
  (): JobManagerRedisConfig => readRedisConfig(),
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
    jobManagerRecoveryConfig,
    jobManagerRedisConfig,
  ],
});

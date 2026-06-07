import { type DynamicModule } from '@nestjs/common';
import {
  ConfigModule,
  type ConfigFactory,
  type ConfigFactoryKeyHost,
  type ConfigObject,
  registerAs,
} from '@nestjs/config';
import {
  readBooleanEnv,
  readScrapeMessagingConfig,
  type ScrapeMessagingConfig,
  parseOptionalBooleanEnv,
} from '@org/domain';
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';
type ApiNodeEnv = 'development' | 'production' | 'test';
type RegisteredConfigFactory<T extends ConfigObject> = ConfigFactory<T> & ConfigFactoryKeyHost<T>;

export interface ApiHttpConfig {
  port: number;
}

export interface ApiServiceConfig {
  serviceName: 'api';
  nodeEnv: ApiNodeEnv;
  logLevel: string;
  http: ApiHttpConfig;
}

export interface ApiJobManagerConfig {
  host: string;
  tcpPort: number;
  requestTimeoutMs: number;
}

export interface ApiStorageConfig {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  defaultBucket?: string;
  presignTtlSeconds: number;
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
  PORT: number = 3000;

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
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  JOB_MANAGER_RPC_TIMEOUT_MS: number = 5000;

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

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SCRAPE_RESULT_PRESIGN_TTL_SECONDS: number = 300;
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
    JOB_MANAGER_RPC_TIMEOUT_MS: String(validatedConfig.JOB_MANAGER_RPC_TIMEOUT_MS),
    SCRAPE_JOB_QUEUE_NAME: validatedConfig.SCRAPE_JOB_QUEUE_NAME,
    SCRAPE_STATUS_QUEUE_NAME: validatedConfig.SCRAPE_STATUS_QUEUE_NAME,
    SCRAPE_JOB_PATTERN: validatedConfig.SCRAPE_JOB_PATTERN,
    SCRAPE_JOB_STATUS_PATTERN: validatedConfig.SCRAPE_JOB_STATUS_PATTERN,
    S3_REGION: validatedConfig.S3_REGION,
    S3_ENDPOINT: validatedConfig.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: String(validatedConfig.S3_FORCE_PATH_STYLE),
    S3_ACCESS_KEY_ID: validatedConfig.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: validatedConfig.S3_SECRET_ACCESS_KEY,
    S3_DEFAULT_BUCKET: validatedConfig.S3_DEFAULT_BUCKET,
    SCRAPE_RESULT_PRESIGN_TTL_SECONDS: String(validatedConfig.SCRAPE_RESULT_PRESIGN_TTL_SECONDS),
  };
}

function readServiceConfig(): ApiServiceConfig {
  return {
    serviceName: 'api',
    nodeEnv: (process.env.NODE_ENV as ApiNodeEnv) || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
      port: Number(process.env.PORT),
    },
  };
}

function readJobManagerConfig(): ApiJobManagerConfig {
  return {
    host: process.env.JOB_MANAGER_HOST || '127.0.0.1',
    tcpPort: Number(process.env.JOB_MANAGER_TCP_PORT),
    requestTimeoutMs: Number(process.env.JOB_MANAGER_RPC_TIMEOUT_MS),
  };
}

function readMessagingConfig(): ScrapeMessagingConfig {
  return readScrapeMessagingConfig(process.env);
}

function readStorageConfig(): ApiStorageConfig {
  return {
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: readBooleanEnv(process.env.S3_FORCE_PATH_STYLE, true),
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    defaultBucket: process.env.S3_DEFAULT_BUCKET || undefined,
    presignTtlSeconds: Number(process.env.SCRAPE_RESULT_PRESIGN_TTL_SECONDS),
  };
}

export const apiServiceConfig: RegisteredConfigFactory<ApiServiceConfig> = registerAs(
  `${APP_CONFIG_NAMESPACE}.service`,
  (): ApiServiceConfig => readServiceConfig(),
);

export const apiJobManagerConfig: RegisteredConfigFactory<ApiJobManagerConfig> = registerAs(
  `${APP_CONFIG_NAMESPACE}.jobManager`,
  (): ApiJobManagerConfig => readJobManagerConfig(),
);

export const apiMessagingConfig: RegisteredConfigFactory<ScrapeMessagingConfig> = registerAs(
  `${APP_CONFIG_NAMESPACE}.messaging`,
  (): ScrapeMessagingConfig => readMessagingConfig(),
);

export const apiStorageConfig: RegisteredConfigFactory<ApiStorageConfig> = registerAs(
  `${APP_CONFIG_NAMESPACE}.storage`,
  (): ApiStorageConfig => readStorageConfig(),
);

export const apiMessagingBindings = readMessagingConfig();

export const apiConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [
    apiServiceConfig,
    apiJobManagerConfig,
    apiMessagingConfig,
    apiStorageConfig,
  ],
});

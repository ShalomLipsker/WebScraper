import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { readScrapeMessagingConfig, type ScrapeMessagingConfig } from '@org/domain';
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';
const DEFAULT_SCRAPER_USER_AGENTS = [
  'Mozilla/5.0 (compatible; WebScraperBot/1.0; +https://example.invalid/bot)',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0',
];
type ScraperNodeEnv = 'development' | 'production' | 'test';

export interface ScraperHttpConfig {
  port: number;
}

export interface ScraperServiceConfig {
  serviceName: 'scraper';
  nodeEnv: ScraperNodeEnv;
  logLevel: string;
  http: ScraperHttpConfig;
}

export interface ScraperStorageConfig {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  defaultBucket?: string;
}

export interface ScraperFetchConfig {
  requestTimeoutMs: number;
  maxRetryAttempts: number;
  maxConcurrentRequests: number;
  minRequestIntervalMs: number;
  baseRetryDelayMs: number;
  userAgents: string[];
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
  PORT: number = 3002;

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
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  })
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
  SCRAPER_REQUEST_TIMEOUT_MS: number = 15_000;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SCRAPER_MAX_RETRY_ATTEMPTS: number = 3;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SCRAPER_MAX_CONCURRENT_REQUESTS: number = 3;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SCRAPER_MIN_REQUEST_INTERVAL_MS: number = 250;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  SCRAPER_BASE_RETRY_DELAY_MS: number = 500;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value?.trim() === '' ? undefined : value))
  SCRAPER_USER_AGENTS: string = DEFAULT_SCRAPER_USER_AGENTS.join(',');
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
    S3_REGION: validatedConfig.S3_REGION,
    S3_ENDPOINT: validatedConfig.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: String(validatedConfig.S3_FORCE_PATH_STYLE),
    S3_ACCESS_KEY_ID: validatedConfig.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: validatedConfig.S3_SECRET_ACCESS_KEY,
    S3_DEFAULT_BUCKET: validatedConfig.S3_DEFAULT_BUCKET,
    SCRAPE_JOB_QUEUE_NAME: validatedConfig.SCRAPE_JOB_QUEUE_NAME,
    SCRAPE_STATUS_QUEUE_NAME: validatedConfig.SCRAPE_STATUS_QUEUE_NAME,
    SCRAPE_JOB_PATTERN: validatedConfig.SCRAPE_JOB_PATTERN,
    SCRAPE_JOB_STATUS_PATTERN: validatedConfig.SCRAPE_JOB_STATUS_PATTERN,
    SCRAPER_REQUEST_TIMEOUT_MS: String(validatedConfig.SCRAPER_REQUEST_TIMEOUT_MS),
    SCRAPER_MAX_RETRY_ATTEMPTS: String(validatedConfig.SCRAPER_MAX_RETRY_ATTEMPTS),
    SCRAPER_MAX_CONCURRENT_REQUESTS: String(validatedConfig.SCRAPER_MAX_CONCURRENT_REQUESTS),
    SCRAPER_MIN_REQUEST_INTERVAL_MS: String(validatedConfig.SCRAPER_MIN_REQUEST_INTERVAL_MS),
    SCRAPER_BASE_RETRY_DELAY_MS: String(validatedConfig.SCRAPER_BASE_RETRY_DELAY_MS),
    SCRAPER_USER_AGENTS: validatedConfig.SCRAPER_USER_AGENTS,
  };
}

function readServiceConfig(): ScraperServiceConfig {
  return {
    serviceName: 'scraper',
    nodeEnv: (process.env.NODE_ENV as ScraperNodeEnv) || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
      port: Number(process.env.PORT),
    },
  };
}

function readStorageConfig(): ScraperStorageConfig {
  return {
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: readBooleanEnv(process.env.S3_FORCE_PATH_STYLE, true),
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    defaultBucket: process.env.S3_DEFAULT_BUCKET || undefined,
  };
}

function readMessagingConfig(): ScrapeMessagingConfig {
  return readScrapeMessagingConfig(process.env);
}

function readFetchConfig(): ScraperFetchConfig {
  return {
    requestTimeoutMs: Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS),
    maxRetryAttempts: Number(process.env.SCRAPER_MAX_RETRY_ATTEMPTS),
    maxConcurrentRequests: Number(process.env.SCRAPER_MAX_CONCURRENT_REQUESTS),
    minRequestIntervalMs: Number(process.env.SCRAPER_MIN_REQUEST_INTERVAL_MS),
    baseRetryDelayMs: Number(process.env.SCRAPER_BASE_RETRY_DELAY_MS),
    userAgents: parseUserAgents(process.env.SCRAPER_USER_AGENTS),
  };
}

export const scraperServiceConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.service`,
  (): ScraperServiceConfig => readServiceConfig(),
);

export const scraperStorageConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.storage`,
  (): ScraperStorageConfig => readStorageConfig(),
);

export const scraperMessagingConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.messaging`,
  (): ScrapeMessagingConfig => readMessagingConfig(),
);

export const scraperFetchConfig = registerAs(
  `${APP_CONFIG_NAMESPACE}.fetch`,
  (): ScraperFetchConfig => readFetchConfig(),
);

export const scraperMessagingBindings = readMessagingConfig();

function parseUserAgents(value: string | undefined): string[] {
  const parsedUserAgents = value
    ?.split(',')
    .map((userAgent) => userAgent.trim())
    .filter((userAgent) => userAgent.length > 0);

  if (!parsedUserAgents || parsedUserAgents.length === 0) {
    return DEFAULT_SCRAPER_USER_AGENTS;
  }

  return parsedUserAgents;
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const scraperConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [
    scraperServiceConfig,
    scraperStorageConfig,
    scraperMessagingConfig,
    scraperFetchConfig,
  ],
});

import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';
const DEFAULT_SCRAPER_USER_AGENTS = [
  'Mozilla/5.0 (compatible; WebScraperBot/1.0; +https://example.invalid/bot)',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0',
];

export interface ScraperConfig {
  serviceName: 'scraper';
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  http: {
    port: number;
  };
  fetch: {
    requestTimeoutMs: number;
    maxRetryAttempts: number;
    maxConcurrentRequests: number;
    minRequestIntervalMs: number;
    baseRetryDelayMs: number;
    userAgents: string[];
  };
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
    SCRAPER_REQUEST_TIMEOUT_MS: String(validatedConfig.SCRAPER_REQUEST_TIMEOUT_MS),
    SCRAPER_MAX_RETRY_ATTEMPTS: String(validatedConfig.SCRAPER_MAX_RETRY_ATTEMPTS),
    SCRAPER_MAX_CONCURRENT_REQUESTS: String(validatedConfig.SCRAPER_MAX_CONCURRENT_REQUESTS),
    SCRAPER_MIN_REQUEST_INTERVAL_MS: String(validatedConfig.SCRAPER_MIN_REQUEST_INTERVAL_MS),
    SCRAPER_BASE_RETRY_DELAY_MS: String(validatedConfig.SCRAPER_BASE_RETRY_DELAY_MS),
    SCRAPER_USER_AGENTS: validatedConfig.SCRAPER_USER_AGENTS,
  };
}

const scraperConfig = registerAs(APP_CONFIG_NAMESPACE, (): ScraperConfig => {
  return {
    serviceName: 'scraper',
    nodeEnv: (process.env.NODE_ENV as ScraperConfig['nodeEnv']) || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
      port: Number(process.env.PORT),
    },
    fetch: {
      requestTimeoutMs: Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS),
      maxRetryAttempts: Number(process.env.SCRAPER_MAX_RETRY_ATTEMPTS),
      maxConcurrentRequests: Number(process.env.SCRAPER_MAX_CONCURRENT_REQUESTS),
      minRequestIntervalMs: Number(process.env.SCRAPER_MIN_REQUEST_INTERVAL_MS),
      baseRetryDelayMs: Number(process.env.SCRAPER_BASE_RETRY_DELAY_MS),
      userAgents: parseUserAgents(process.env.SCRAPER_USER_AGENTS),
    },
  };
});

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

export const scraperConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [scraperConfig],
});

export function getAppConfig(configService: ConfigService): ScraperConfig {
  return configService.getOrThrow<ScraperConfig>(APP_CONFIG_NAMESPACE);
}

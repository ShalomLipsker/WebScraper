import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { readScrapeMessagingConfig, type ScrapeMessagingConfig } from '@org/domain';
import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';

export interface JobManagerAppConfig {
  serviceName: 'job-manager';
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  http: {
    port: number;
  };
  transport: {
    host: string;
    tcpPort: number;
  };
  messaging: ScrapeMessagingConfig;
  recovery: {
    submittedDelayMs: number;
    submittedLeaseSeconds: number;
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
  };
}

export const jobManagerMessagingBindings = readScrapeMessagingConfig(process.env);

const jobManagerConfig = registerAs(
  APP_CONFIG_NAMESPACE,
  (): JobManagerAppConfig => {
    return {
      serviceName: 'job-manager',
      nodeEnv: (process.env.NODE_ENV as JobManagerAppConfig['nodeEnv']) || 'development',
      logLevel: process.env.LOG_LEVEL || 'info',
      http: {
        port: Number(process.env.PORT),
      },
      transport: {
        host: process.env.JOB_MANAGER_HOST || '127.0.0.1',
        tcpPort: Number(process.env.JOB_MANAGER_TCP_PORT),
      },
      messaging: jobManagerMessagingBindings,
      recovery: {
        submittedDelayMs: Number(process.env.SUBMITTED_RECOVERY_DELAY_MS),
        submittedLeaseSeconds: Number(process.env.SUBMITTED_RECOVERY_LEASE_SECONDS),
      },
    };
  },
);

export const jobManagerConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [jobManagerConfig],
});

export function getAppConfig(configService: ConfigService): JobManagerAppConfig {
  return configService.getOrThrow<JobManagerAppConfig>(APP_CONFIG_NAMESPACE);
}

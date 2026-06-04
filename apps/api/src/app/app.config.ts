import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';

export interface ApiConfig {
  serviceName: 'api';
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  http: {
    port: number;
  };
  jobManager: {
    host: string;
    tcpPort: number;
  };
  storage: {
    region: string;
    endpoint?: string;
    forcePathStyle: boolean;
    accessKeyId?: string;
    secretAccessKey?: string;
    defaultBucket?: string;
    presignTtlSeconds: number;
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
    S3_REGION: validatedConfig.S3_REGION,
    S3_ENDPOINT: validatedConfig.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: String(validatedConfig.S3_FORCE_PATH_STYLE),
    S3_ACCESS_KEY_ID: validatedConfig.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: validatedConfig.S3_SECRET_ACCESS_KEY,
    S3_DEFAULT_BUCKET: validatedConfig.S3_DEFAULT_BUCKET,
    SCRAPE_RESULT_PRESIGN_TTL_SECONDS: String(validatedConfig.SCRAPE_RESULT_PRESIGN_TTL_SECONDS),
  };
}

const apiConfig = registerAs(APP_CONFIG_NAMESPACE, (): ApiConfig => {
  return {
    serviceName: 'api',
    nodeEnv: (process.env.NODE_ENV as ApiConfig['nodeEnv']) || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
      port: Number(process.env.PORT),
    },
    jobManager: {
      host: process.env.JOB_MANAGER_HOST || '127.0.0.1',
      tcpPort: Number(process.env.JOB_MANAGER_TCP_PORT),
    },
    storage: {
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: readBooleanEnv(process.env.S3_FORCE_PATH_STYLE, true),
      accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      defaultBucket: process.env.S3_DEFAULT_BUCKET || undefined,
      presignTtlSeconds: Number(process.env.SCRAPE_RESULT_PRESIGN_TTL_SECONDS),
    },
  };
});

export const apiConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [apiConfig],
});

export function getAppConfig(configService: ConfigService): ApiConfig {
  return configService.getOrThrow<ApiConfig>(APP_CONFIG_NAMESPACE);
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

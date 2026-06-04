import { type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const APP_CONFIG_NAMESPACE = 'app';

export interface ScraperConfig {
  serviceName: 'scraper';
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  http: {
    port: number;
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
  };
});

export const scraperConfigModule: Promise<DynamicModule> = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnvironmentVariables,
  load: [scraperConfig],
});

export function getAppConfig(configService: ConfigService): ScraperConfig {
  return configService.getOrThrow<ScraperConfig>(APP_CONFIG_NAMESPACE);
}

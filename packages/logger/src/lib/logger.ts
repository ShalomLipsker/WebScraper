import { randomUUID } from 'node:crypto';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Logger as NestjsPinoLogger,
  LoggerModule as NestjsPinoLoggerModule,
  type Params,
} from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

const DEFAULT_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

type HeaderValue = string | string[] | undefined;

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

export interface StructuredLogPayload {
  event: string;
  requestId?: string;
  correlationId?: string;
  durationMs?: number;
  errorName?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface RequestWithHeaders {
  id?: unknown;
  headers?: Record<string, HeaderValue>;
}

export interface StructuredLoggerModuleOptions {
  serviceName: string;
  level?: string;
}

export { NestjsPinoLogger as PinoLoggerService };

function getHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function getRequestId(request: RequestWithHeaders): string | undefined {
  const currentRequestId = typeof request.id === 'string' ? request.id : undefined;

  return currentRequestId ?? getHeaderValue(request.headers?.[REQUEST_ID_HEADER]);
}

export function getCorrelationId(
  headers?: Record<string, HeaderValue>,
): string | undefined {
  return getHeaderValue(headers?.[CORRELATION_ID_HEADER]);
}

export function resolveCorrelationId(
  correlationId?: string,
  requestId?: string,
): string | undefined {
  return correlationId ?? requestId;
}

export function getDurationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export function getErrorLogFields(error: unknown): Pick<
  StructuredLogPayload,
  'errorName' | 'errorMessage'
> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }

  return {
    errorMessage: 'Unknown error',
  };
}

export const toErrorFields = getErrorLogFields;

export function createStructuredLoggerOptions(
  options: StructuredLoggerModuleOptions,
): Params {
  const level = options.level ?? 'info';

  return {
    renameContext: 'context',
    pinoHttp: {
      level,
      timestamp: stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      redact: {
        paths: DEFAULT_REDACT_PATHS,
        censor: '[Redacted]',
      },
      messageKey: 'message',
      customAttributeKeys: {
        req: 'request',
        res: 'response',
        err: 'error',
        responseTime: 'durationMs',
      },
      customProps: () => ({
        service: options.serviceName,
      }),
      genReqId: (request) => {
        const requestId =
          getRequestId(request as RequestWithHeaders)
          ?? randomUUID();

        (request as { id?: unknown }).id = requestId;
        return requestId;
      },
      customReceivedMessage: () => 'request received',
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request failed',
    },
  };
}

@Global()
@Module({})
export class StructuredLoggerModule {
  static register(
    options: StructuredLoggerModuleOptions,
  ): DynamicModule {
    return {
      module: StructuredLoggerModule,
      imports: [
        ConfigModule,
        NestjsPinoLoggerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService) =>
            createStructuredLoggerOptions({
              ...options,
              level:
                options.level ??
                configService.get<string>('app.service.logLevel', 'info'),
            }),
        }),
      ],
      exports: [NestjsPinoLoggerModule],
    };
  }
}

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
        const currentRequestId = (request as { id?: unknown }).id;
        const requestId =
          (typeof currentRequestId === 'string' ? currentRequestId : undefined) ??
          getHeaderValue(request.headers?.['x-request-id']) ??
          randomUUID();

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
                configService.get<string>('app.logLevel', 'info'),
            }),
        }),
      ],
      exports: [NestjsPinoLoggerModule],
    };
  }
}

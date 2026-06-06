import {
  ROOT_CONTEXT,
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  propagation,
} from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

const TRACE_CONTEXT_HEADER_NAMES = ['traceparent', 'tracestate', 'baggage'] as const;

export interface TraceContextCarrier {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}

export interface OpenTelemetryBootstrapOptions {
  serviceName: string;
}

interface OpenTelemetryState {
  sdk?: NodeSDK;
  serviceName?: string;
  shutdownRegistered: boolean;
}

type TraceContextHeaderName = (typeof TRACE_CONTEXT_HEADER_NAMES)[number];

const globalState = getGlobalState();

export function registerOpenTelemetry(
  options: OpenTelemetryBootstrapOptions,
): void {
  configureProcessTelemetryDefaults(options);

  if (globalState.sdk) {
    if (globalState.serviceName && globalState.serviceName !== options.serviceName) {
      throw new Error(
        `OpenTelemetry already initialized for service ${globalState.serviceName}`,
      );
    }

    return;
  }

  const sdk = new NodeSDK({
    autoDetectResources: true,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  globalState.sdk = sdk;
  globalState.serviceName = options.serviceName;

  try {
    const started = sdk.start();

    if (isPromiseLike(started)) {
      void started.catch((error: unknown) => {
        reportOpenTelemetryError('start', error);
      });
    }
  } catch (error: unknown) {
    reportOpenTelemetryError('start', error);
  }

  registerShutdownHandlers();
}

export function extractTraceContextCarrier(
  carrier: Record<string, unknown> | undefined,
): TraceContextCarrier | undefined {
  if (!carrier) {
    return undefined;
  }

  const normalizedCarrier = Object.entries(carrier).reduce<Record<string, unknown>>(
    (result, [key, value]) => {
      result[key.toLowerCase()] = value;
      return result;
    },
    {},
  );

  const traceContext = TRACE_CONTEXT_HEADER_NAMES.reduce<TraceContextCarrier>(
    (result, headerName) => {
      const value = normalizeTraceHeaderValue(normalizedCarrier[headerName]);

      if (value) {
        result[headerName] = value;
      }

      return result;
    },
    {},
  );

  return hasTraceContext(traceContext) ? traceContext : undefined;
}

export function getActiveTraceContextCarrier(): TraceContextCarrier | undefined {
  const carrier: Record<string, string> = {};

  propagation.inject(context.active(), carrier);

  return extractTraceContextCarrier(carrier);
}

export function getTraceContextHeaders(
  traceContext: TraceContextCarrier | undefined,
): Record<string, string> {
  if (!traceContext) {
    return {};
  }

  const normalizedTraceContext = extractTraceContextCarrier(
    traceContext as Record<string, unknown>,
  );

  if (!normalizedTraceContext) {
    return {};
  }

  return TRACE_CONTEXT_HEADER_NAMES.reduce<Record<string, string>>(
    (result, headerName) => {
      const value = normalizedTraceContext[headerName];

      if (value) {
        result[headerName] = value;
      }

      return result;
    },
    {},
  );
}

export function withTraceContext<T>(
  traceContext: TraceContextCarrier | undefined,
  operation: () => T,
): T {
  if (!traceContext) {
    return operation();
  }

  const remoteContext = propagation.extract(
    ROOT_CONTEXT,
    getTraceContextHeaders(traceContext),
  );

  return context.with(remoteContext, operation);
}

function configureProcessTelemetryDefaults(
  options: OpenTelemetryBootstrapOptions,
): void {
  process.env.OTEL_SERVICE_NAME ??= options.serviceName;
  process.env.OTEL_PROPAGATORS ??= 'tracecontext,baggage';

  if (process.env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }
}

function getGlobalState(): OpenTelemetryState {
  const scope = globalThis as typeof globalThis & {
    __orgOpenTelemetryState?: OpenTelemetryState;
  };

  scope.__orgOpenTelemetryState ??= {
    shutdownRegistered: false,
  };

  return scope.__orgOpenTelemetryState;
}

function registerShutdownHandlers(): void {
  if (globalState.shutdownRegistered) {
    return;
  }

  globalState.shutdownRegistered = true;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownOpenTelemetry(signal);
    });
  }
}

async function shutdownOpenTelemetry(signal: NodeJS.Signals): Promise<void> {
  const sdk = globalState.sdk;

  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error: unknown) {
    reportOpenTelemetryError(`shutdown (${signal})`, error);
  }
}

function normalizeTraceHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalizedValue = normalizeTraceHeaderValue(item);

      if (normalizedValue) {
        return normalizedValue;
      }
    }
  }

  return undefined;
}

function hasTraceContext(traceContext: TraceContextCarrier): boolean {
  return TRACE_CONTEXT_HEADER_NAMES.some((headerName) => Boolean(traceContext[headerName]));
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && 'then' in value
    && typeof value.then === 'function',
  );
}

function reportOpenTelemetryError(phase: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[otel] failed to ${phase} OpenTelemetry SDK: ${message}`);
}

export { TRACE_CONTEXT_HEADER_NAMES };
export type { TraceContextHeaderName };

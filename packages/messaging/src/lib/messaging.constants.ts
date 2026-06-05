export const MESSAGE_QUEUE_TOKEN = Symbol('MESSAGE_QUEUE_TOKEN');
export const RABBITMQ_MESSAGING_OPTIONS_TOKEN = Symbol(
  'RABBITMQ_MESSAGING_OPTIONS_TOKEN',
);

export const DEFAULT_QUEUE_NAME = 'default-job-queue';
export const DEFAULT_JOB_NAME = 'default-job';
export const DEFAULT_EXCHANGE_NAME = 'jobs';
export const DEFAULT_EXCHANGE_TYPE = 'topic';
export const DEFAULT_JOB_ATTEMPTS = 5;
export const DEFAULT_JOB_BACKOFF_DELAY_MS = 1_000;
export const DEFAULT_JOB_BACKOFF_TYPE = 'exponential';
export const DEFAULT_JOB_HISTORY_AGE_SECONDS = 86_400;
export const DEFAULT_JOB_HISTORY_COUNT = 1_000;
export const DEFAULT_WORKER_CONCURRENCY = 1;
export const RABBITMQ_DEDUPLICATION_HEADER = 'x-deduplication-header';
export const RABBITMQ_CORRELATION_ID_HEADER = 'x-correlation-id';
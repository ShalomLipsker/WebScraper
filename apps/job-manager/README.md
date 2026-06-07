# Job Manager

The `job-manager` app owns scrape job orchestration. It receives internal submit and status messages, hashes URLs into deterministic job IDs, persists job state in PostgreSQL, publishes work through a transactional outbox to RabbitMQ, and handles cleanup of expired jobs and storage assets.

## Responsibilities

- Deduplicate jobs by SHA-256 hash of the URL
- Persist lifecycle state in the job repository
- Publish scrape work through the outbox dispatcher
- Delete published outbox records after their configured retention TTL
- Consume worker status updates from the status queue
- Recover stale `SUBMITTED`, `ENQUEUED`, and `PROCESSING` jobs
- Delete expired jobs and associated storage assets with distributed-safe leases

## Run

```bash
pnpm nx serve job-manager
```

Default local ports:

- HTTP: `3001`
- TCP transport: `4001`

## Dependencies

- PostgreSQL for persistence, outbox records, and recovery leases
- RabbitMQ for work and status transport
- Internal callers such as `api` using Nest TCP messaging

## Tests

This app currently has focused service and integration tests under `test/`.

Run them with:

```bash
pnpm exec vitest run apps/job-manager/test/*.spec.ts
```

## Related files

- `src/app/scrape-jobs.controller.ts`
- `src/app/scrape-jobs.service.ts`
- `src/app/scrape-job-status-updates.service.ts`
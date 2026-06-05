# Job Manager

The `job-manager` app owns scrape job orchestration. It receives internal submit and status messages, hashes URLs into deterministic job IDs, persists job state, publishes BullMQ work items, and reconciles stale jobs when status is queried.

## Responsibilities

- Deduplicate jobs by SHA-256 hash of the URL
- Persist lifecycle state in the job repository
- Publish scrape work to the main queue
- Consume worker status updates from the status queue
- Recover stale `SUBMITTED`, `ENQUEUED`, and `PROCESSING` jobs

## Run

```bash
pnpm nx serve job-manager
```

Default local ports:

- HTTP: `3001`
- TCP transport: `4001`

## Dependencies

- Redis for persistence and BullMQ transport
- Internal callers such as `api` using Nest TCP messaging

## Related files

- `src/app/scrape-jobs.controller.ts`
- `src/app/scrape-jobs.service.ts`
- `src/app/scrape-job-status-updates.service.ts`
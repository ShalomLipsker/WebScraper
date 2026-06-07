# Scraper

The `scraper` app runs the asynchronous worker. It consumes queued scrape jobs, fetches HTML for the target URL, uploads the result to S3-compatible storage, and emits lifecycle updates back to `job-manager`.

## Responsibilities

- Listen to the scrape job queue
- Mark jobs as `PROCESSING`, `COMPLETED`, or `FAILED`
- Fetch raw HTML with retry, backoff, throttling, and rotating user agents
- Store completed HTML objects in the configured bucket

## Run

```bash
pnpm nx serve scraper
```

Default local port: `3002`

## Dependencies

- RabbitMQ for job consumption and status publication
- S3-compatible storage for result uploads

## Tests

This app currently has focused scrape engine and worker unit tests under `test/`.

Run them with:

```bash
pnpm exec vitest run apps/scraper/test/*.spec.ts
```

## Related files

- `src/app/scrape-worker.service.ts`
- `src/app/scrape-engine.service.ts`
- `src/app/scrape.constants.ts`
# API

The `api` app is the public HTTP entrypoint for the scraping system. It accepts scrape requests, proxies job commands to `job-manager` over Nest TCP transport, and serves completed HTML either as a streamed response or as a presigned object-storage URL.

## Endpoints

- `POST /scrape` submits a URL for scraping.
- `GET /scrape/:jobId/status` returns the current lifecycle state.
- `GET /scrape/:jobId/content` streams completed HTML.
- `GET /scrape/:jobId/content-url` returns a presigned URL for the stored result.

## Run

```bash
pnpm nx serve api
```

Default local port: `3000`

## Dependencies

- `job-manager` TCP transport on `JOB_MANAGER_HOST:JOB_MANAGER_TCP_PORT`
- API-side RPC deadline via `JOB_MANAGER_RPC_TIMEOUT_MS` (default `5000`)
- S3-compatible storage for completed result retrieval

## Tests

This app currently has focused controller, gateway service, and HTTP integration
tests under `test/`.

Run them with:

```bash
pnpm exec vitest run apps/api/test/*.spec.ts
```

## Related files

- `src/app/scrape.controller.ts`
- `src/app/scrape-gateway.service.ts`
- `src/app/job-manager-client.ts`
# WebScraper

WebScraper is an Nx monorepo for an asynchronous HTML scraping pipeline built with NestJS. A public API accepts scrape requests, a job-manager service deduplicates and orchestrates them through BullMQ and Redis, and a scraper worker fetches HTML and stores results in MinIO-compatible object storage.

## Overview

- `api` exposes the HTTP contract used by clients.
- `job-manager` owns job IDs, lifecycle state, queue publish, and recovery logic.
- `scraper` consumes queued jobs, fetches HTML, and uploads results to object storage.
- Shared libraries under `packages/` provide domain types, logging, messaging, persistence, and storage adapters.

## Architecture

```text
Client
	-> api (HTTP)
	-> job-manager (Nest TCP transport)
	-> Redis + BullMQ
	-> scraper worker
	-> MinIO / S3-compatible storage
	-> api returns status, streamed HTML, or presigned URL
```

### Service map

| Service | Port | Responsibility |
| --- | --- | --- |
| `api` | `3000` | Accepts scrape requests and serves job status and results |
| `job-manager` | `3001` HTTP, `4001` TCP | Deduplicates jobs, persists lifecycle state, publishes queue messages, reconciles stale jobs |
| `scraper` | `3002` | Runs the worker that fetches HTML and publishes status updates |
| `redis` | `6379` | Queue backend and job persistence backing store |
| `minio` | `9000` API, `9001` console | Stores scraped HTML objects |

## Scrape flow

1. `POST /scrape` submits a URL.
2. `job-manager` normalizes the URL, hashes it with SHA-256, and creates or reuses the job record.
3. A new job is published to the scrape queue and moved from `SUBMITTED` to `ENQUEUED`.
4. `scraper` marks the job `PROCESSING`, fetches the HTML, uploads it to storage, and emits `COMPLETED` or `FAILED`.
5. `api` exposes the lifecycle state through polling and can return either the HTML stream or a presigned storage URL.

The shared job lifecycle is:

`SUBMITTED -> ENQUEUED -> PROCESSING -> COMPLETED | FAILED`

## HTTP API

### Submit a scrape job

```http
POST /scrape
Content-Type: application/json

{
	"url": "https://example.com"
}
```

The request body must contain a valid `http` or `https` URL.

Example response:

```json
{
	"accepted": true,
	"jobId": "<sha256-of-url>",
	"url": "https://example.com",
	"status": "ENQUEUED"
}
```

### Check job status

```http
GET /scrape/:jobId/status
```

Example response:

```json
{
	"jobId": "<job-id>",
	"url": "https://example.com",
	"status": "COMPLETED",
	"createdAt": "2026-06-05T12:00:00.000Z",
	"updatedAt": "2026-06-05T12:00:05.000Z",
	"resultPath": "scrape-results/<job-id>.html"
}
```

### Stream the scraped HTML

```http
GET /scrape/:jobId/content
```

Returns the HTML as an inline `text/html` response when the job is complete.

### Get a presigned storage URL

```http
GET /scrape/:jobId/content-url
```

Returns a JSON payload with a short-lived presigned URL for the stored HTML object.

## Local development

### Prerequisites

- Node.js 20+
- `pnpm`
- Docker and Docker Compose for Redis and MinIO, or for running the full stack in containers

### Install dependencies

```bash
pnpm install
```

### Run the full stack with Docker Compose

```bash
docker compose up --build
```

This starts Redis, MinIO, and the three apps with the default ports shown above. MinIO is initialized with a `scrape-results` bucket.

Default local MinIO credentials:

- Username: `minio`
- Password: `minio123`
- Console: `http://localhost:9001`

### Run the services individually with Nx

Start infrastructure first if you are not using the full Compose stack:

```bash
docker compose up redis minio minio-init
```

Then start each app in a separate terminal:

```bash
pnpm nx serve job-manager
pnpm nx serve scraper
pnpm nx serve api
```

Useful build commands:

```bash
pnpm nx build api
pnpm nx build job-manager
pnpm nx build scraper
pnpm nx typecheck api
pnpm nx typecheck job-manager
pnpm nx typecheck scraper
```

## Simulate a scrape request

The repository includes a small client script that submits a job, polls until completion, and optionally opens the HTML result in a browser.

```bash
pnpm simulate:scrape
```

You can also pass a target URL:

```bash
pnpm simulate:scrape -- https://example.com
```

For CLI help:

```bash
node scripts/simulate-scrape-request.mjs --help
```

## Workspace layout

```text
apps/
	api/
	job-manager/
	scraper/
packages/
	domain/
	logger/
	messaging/
	persistence/
	storage/
```

## Notes

- `job-manager` performs lazy reconciliation for stale `SUBMITTED`, `ENQUEUED`, and `PROCESSING` jobs.
- Deduplication is based on the SHA-256 hash of the submitted URL.
- The scraper currently fetches HTML over HTTP with Axios and retry/backoff logic.
- Result objects are stored under the `scrape-results/` key prefix in the configured bucket.

## App readmes

- [apps/api/README.md](apps/api/README.md)
- [apps/job-manager/README.md](apps/job-manager/README.md)
- [apps/scraper/README.md](apps/scraper/README.md)

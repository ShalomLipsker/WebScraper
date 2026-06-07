# WebScraper

WebScraper is an Nx monorepo for an asynchronous HTML scraping pipeline built with NestJS. A public API accepts scrape requests, a job-manager service deduplicates and persists them in PostgreSQL, publishes work through a transactional outbox to RabbitMQ, and a scraper worker fetches HTML and stores results in MinIO-compatible object storage.

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
	-> PostgreSQL + RabbitMQ
	-> scraper worker
	-> MinIO / S3-compatible storage
	-> api returns status, streamed HTML, or presigned URL
```

### Service map

| Service | Port | Responsibility |
| --- | --- | --- |
| `api` | `3000` | Accepts scrape requests and serves job status and results |
| `job-manager` | `3001` HTTP, `4001` TCP | Deduplicates jobs, persists lifecycle state, dispatches outbox messages, and handles expired job cleanup |
| `scraper` | `3002` | Runs the worker that fetches HTML and publishes status updates |
| `postgres` | `5432` | Job persistence, transactional outbox, and recovery leases |
| `rabbitmq` | `5672` AMQP, `15672` management | Work queue transport for scrape jobs and status updates |
| `minio` | `9000` API, `9001` console | Stores scraped HTML objects |
| `tempo` | `3200` API, `4317` gRPC OTLP, `4318` HTTP OTLP | Trace backend for Grafana |
| `loki` | `3100` | Log backend for Grafana |
| `grafana` | `3003` | Local dashboards, logs, and traces UI |

## Scrape flow

1. `POST /scrape` submits a URL.
2. `job-manager` normalizes the URL, hashes it with SHA-256, and creates or reuses the job record.
3. A new job and an outbox message are created in one PostgreSQL transaction.
4. `job-manager` dispatches pending outbox messages to RabbitMQ and moves the job from `SUBMITTED` to `ENQUEUED`.
5. `scraper` marks the job `PROCESSING`, fetches the HTML, uploads it to storage, and emits `COMPLETED` or `FAILED`.
6. `api` exposes the lifecycle state through polling and can return either the HTML stream or a presigned storage URL.

The shared job lifecycle is:

`SUBMITTED -> ENQUEUED -> PROCESSING -> COMPLETED | FAILED`

## HTTP API

### Submit a scrape job

```http
POST /scrape
Content-Type: application/json

{
	"url": "https://example.com",
	"proxy": "http://proxy.example:8080"
}
```

The request body must contain a valid `http` or `https` URL. You can also provide an optional proxy URL with the `proxy` field when the scrape should be executed through an `http` or `https` proxy.

If you do not want to use a proxy, omit the `proxy` field.

Example response:

```json
{
	"accepted": true,
	"jobId": "<sha256-of-url-and-proxy>",
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
- Docker and Docker Compose for PostgreSQL, RabbitMQ, and MinIO, or for running the full stack in containers

### Install dependencies

```bash
pnpm install
```

### Run the full stack with Docker Compose

```bash
docker compose up --build
```

This starts PostgreSQL, RabbitMQ, MinIO, and the three apps with the default ports shown above. MinIO is initialized with a `scrape-results` bucket.

Grafana observability endpoints after Compose starts:

- Grafana: `http://localhost:3003` with `admin` / `admin`
- Tempo API: `http://localhost:3200`
- Loki API: `http://localhost:3100`

Grafana is pre-provisioned with both Tempo and Loki datasources, plus a `WebScraper Observability` dashboard for log-derived service activity, job outcomes, recent errors, and application drill-downs. Grafana Alloy discovers the Docker containers in the Compose stack, extracts structured fields from the JSON app logs, and ships them to Loki.

Default local MinIO credentials:

- Username: `minio`
- Password: `minio123`
- Console: `http://localhost:9001`

### Run the services individually with Nx

Start infrastructure first if you are not using the full Compose stack:

```bash
docker compose up postgres rabbitmq minio minio-init
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

## Run a durability stress test

The repository also includes a stress runner that drives concurrent submit-and-poll traffic through the live API so you can pressure the job lifecycle under larger batches.

```bash
pnpm stress:scrape -- --jobs 250 --submit-concurrency 25 --poll-interval-ms 500
```

Useful variants:

```bash
pnpm stress:scrape -- --jobs 500 --submit-concurrency 50 --url-template 'https://example.com/?job={job}&ts={timestamp}'
pnpm stress:scrape -- --jobs 100 --urls-file ./scripts/stress-urls.txt --url-padding-bytes 4096
node scripts/stress-scrape-request.mjs --help
```

The runner exits non-zero if submissions fail, jobs time out, or the scrape pipeline returns failed jobs. It prints throughput, latency percentiles, status request counts, and sampled failures at the end.

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

## Structured logging

The monorepo uses the shared Pino/Nest logger in `@org/logger`. Keep logs event-based and reuse stable field names so a single request can be traced across API, job-manager, persistence, RabbitMQ, and scraper workers.

- Common fields: `event`, `service`, `requestId`, `correlationId`, `jobId`, `durationMs`, `outcome`, `attempt`, `maxAttempts`, `queueName`.
- HTTP ingress should reuse the request ID generated by `nestjs-pino` and pass it forward as `correlationId` when it starts asynchronous work.
- Queue-backed flows should keep `correlationId` in both RabbitMQ headers and domain payloads so outbox dispatch and retries preserve the same trace context.
- Use `log` for expected lifecycle transitions, `warn` for retries/contention/ignored transitions, and `error` for failed operations.
- Never log secrets, cookies, auth headers, signed URLs, or full scraped HTML payloads.

## Notes

- `job-manager` uses a transactional outbox for initial job publication and performs lease-based cleanup for expired jobs.
- Deduplication is based on the SHA-256 hash of the submitted URL.
- The scraper currently fetches HTML over HTTP with Axios and retry/backoff logic.
- Result objects are stored under the `scrape-results/` key prefix in the configured bucket.

### Known issues

- Job status updates can be lost permanently if the job-manager crashes after consuming the status update message more than max retry attempts. 
- Aggressive polling for task statuses can degrade Postgres performance, particularly with a high volume of concurrent jobs. To mitigate this issue, we can implement caching for recently updated job records in the job-manager service. This would reduce the number of direct database queries for status checks and improve overall performance under load.

## App readmes

- [apps/api/README.md](apps/api/README.md)
- [apps/job-manager/README.md](apps/job-manager/README.md)
- [apps/scraper/README.md](apps/scraper/README.md)

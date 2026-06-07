# @org/domain

Shared domain contracts for the scraping pipeline.

This package contains the core job lifecycle types used across the API,
job-manager, scraper, and persistence layers. It is intentionally limited to
portable TypeScript types and interfaces so other packages can depend on it
without pulling in infrastructure concerns.

## Build

Run `pnpm nx build domain` to build the library.

## Tests

This package currently has focused unit tests for the scrape URL and proxy
validators in `test/scrape-job.types.spec.ts`.

Run the package tests with `pnpm --filter @org/domain test`.

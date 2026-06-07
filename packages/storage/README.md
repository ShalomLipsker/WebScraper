# @org/storage

Shared S3-compatible object storage adapter for the scraping pipeline.

This package provides the NestJS storage module and `S3StorageService` used to
store, fetch, delete, and resolve scraped result objects.

## Build

Run `pnpm nx build storage` to build the library.

## Tests

This package currently has a focused unit test for `resolveStorageLocation` and
an S3 integration test for the `S3StorageService` object round trip under
`test/`.

Run the package tests with `pnpm exec vitest run packages/storage/test/*.spec.ts`.
The integration suite requires `S3_DEFAULT_BUCKET` and uses the standard S3 env
vars (`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`) when provided.

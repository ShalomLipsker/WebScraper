# @org/persistence

PostgreSQL-backed persistence primitives for the scraping pipeline.

This package provides the NestJS module and repository implementation used to
store and update scrape job metadata behind the shared `IJobRepository`
contract from `@org/domain`, along with the transactional outbox support used
by `job-manager`.

## Usage

```ts
import { Inject, Injectable, Module } from '@nestjs/common';
import type { IJobRepository } from '@org/domain';
import {
	JOB_REPOSITORY_TOKEN,
	PersistenceModule,
} from '@org/persistence';

@Injectable()
export class JobsService {
	constructor(
		@Inject(JOB_REPOSITORY_TOKEN)
		private readonly jobs: IJobRepository,
	) {}

	createPendingJob(id: string, url: string) {
		return this.jobs.createJob({
			id,
			url,
			status: 'PENDING',
		});
	}
}

@Module({
	imports: [
		PersistenceModule.register({
			url: process.env.POSTGRES_URL,
			synchronize: true,
			jobRetentionSeconds: 60 * 60 * 24,
		}),
	],
	providers: [JobsService],
})
export class JobsModule {}
```

Defaults: `synchronize: true` and `jobRetentionSeconds: 86400`. Override them
with `PersistenceModule.register({ url, synchronize, jobRetentionSeconds })`.

## Build

Run `pnpm nx build persistence` to build the library.

## Tests

This package currently has focused PostgreSQL integration tests for the
repository, submission store, outbox service, and advisory lock runner under
`test/*.integration.spec.ts`.

Run the package tests with `pnpm --filter @org/persistence test`.
The integration suite expects PostgreSQL to be available at
`postgresql://postgres:postgres@127.0.0.1:5432/webscraper` unless
`POSTGRES_URL` is set.


### Notes

- Job submission can be coordinated through the exported submission and outbox store tokens for transactional create-and-publish flows.
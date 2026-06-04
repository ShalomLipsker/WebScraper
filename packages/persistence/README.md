# @org/persistence

Redis-backed persistence primitives for the scraping pipeline.

This package provides the NestJS module and repository implementation used to
store and update scrape job metadata behind the shared `IJobRepository`
contract from `@org/domain`.

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
			url: process.env.REDIS_URL,
			keyPrefix: 'jobs:',
			ttlSeconds: 60 * 60 * 24,
		}),
	],
	providers: [JobsService],
})
export class JobsModule {}
```

Defaults: key prefix `jobs:` and TTL `86400` seconds. Override them with
`PersistenceModule.register({ keyPrefix, ttlSeconds, url, redis })`.

## Build

Run `pnpm nx build persistence` to build the library.


### Known Issues

- The `updateJobStatus` method in `RedisJobRepository` is not atomic and may not be safe to use in a concurrent environment. Currently, it assumes that only one process will be updating the status of a job. In the future, an optimistic locking mechanism may be added to address this issue.
#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const child = spawnSync(
  process.execPath,
  [new URL('./simulate-scrape-request.mjs', import.meta.url).pathname, '--stress', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);

if (typeof child.status === 'number') {
  process.exitCode = child.status;
} else if (child.error) {
  throw child.error;
} else {
  process.exitCode = 1;
}
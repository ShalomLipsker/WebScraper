#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULTS = {
  apiBaseUrl: 'http://localhost:3000',
  url: createDefaultUrl(),
  pollIntervalMs: 2000,
  timeoutMs: 5 * 60 * 1000,
  openBrowser: true,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl);
  const startedAt = Date.now();

  process.stdout.write(`Submitting scrape request for ${options.url}\n`);
  const acknowledgement = await submitScrapeRequest(apiBaseUrl, options.url);

  process.stdout.write(
    `Accepted job ${acknowledgement.jobId} with initial status ${acknowledgement.status}\n`,
  );

  const job = await waitForCompletion({
    apiBaseUrl,
    jobId: acknowledgement.jobId,
    pollIntervalMs: options.pollIntervalMs,
    timeoutMs: options.timeoutMs,
    startedAt,
  });

  process.stdout.write(`\nFinal status: ${job.status}\n`);

  if (job.status === 'FAILED') {
    const failureMessage = job.errorMessage || 'The scrape job failed without an error message.';
    throw new Error(failureMessage);
  }

  const browserUrl = getBrowserResultUrl(apiBaseUrl, job.jobId);
  const accessView = await getCompletedResultUrl(apiBaseUrl, job.jobId);

  process.stdout.write(`Browser URL: ${browserUrl}\n`);
  process.stdout.write(`Storage URL: ${accessView.presignedUrl}\n`);
  process.stdout.write(`URL expires at: ${accessView.expiresAt}\n`);

  if (!options.openBrowser) {
    process.stdout.write('Browser opening skipped by flag.\n');
    return;
  }

  await openInBrowser(browserUrl);
  process.stdout.write('Browser open command sent.\n');
}

async function submitScrapeRequest(apiBaseUrl, url) {
  const response = await fetch(`${apiBaseUrl}/scrape`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  return readJsonResponse(response, 'Unable to submit scrape request');
}

async function getJobStatus(apiBaseUrl, jobId) {
  const response = await fetch(`${apiBaseUrl}/scrape/${jobId}/status`);

  return readJsonResponse(response, `Unable to fetch status for job ${jobId}`);
}

async function getCompletedResultUrl(apiBaseUrl, jobId) {
  const response = await fetch(`${apiBaseUrl}/scrape/${jobId}/content-url`);

  return readJsonResponse(response, `Unable to fetch result URL for job ${jobId}`);
}

function getBrowserResultUrl(apiBaseUrl, jobId) {
  return `${apiBaseUrl}/scrape/${jobId}/content`;
}

async function waitForCompletion({
  apiBaseUrl,
  jobId,
  pollIntervalMs,
  timeoutMs,
  startedAt,
}) {
  while (Date.now() - startedAt <= timeoutMs) {
    const job = await getJobStatus(apiBaseUrl, jobId);
    renderStatusLine(job, startedAt);

    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return job;
    }

    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for job ${jobId} after ${timeoutMs}ms`);
}

function renderStatusLine(job, startedAt) {
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const message = `\r[${elapsedSeconds}s] job=${job.jobId} status=${job.status} updated=${job.updatedAt}`;

  if (process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(message);
    return;
  }

  process.stdout.write(`${message.slice(1)}\n`);
}

async function readJsonResponse(response, contextMessage) {
  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null
      ? JSON.stringify(data)
      : text || response.statusText;
    throw new Error(`${contextMessage}: ${response.status} ${detail}`);
  }

  if (data === null) {
    throw new Error(`${contextMessage}: empty response body`);
  }

  return data;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON response but received: ${text}`);
  }
}

async function openInBrowser(targetUrl) {
  const openCommand = getOpenCommand(targetUrl);

  if (!openCommand) {
    throw new Error(`Unsupported platform ${process.platform}; open this URL manually: ${targetUrl}`);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(openCommand.command, openCommand.args, {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function getOpenCommand(targetUrl) {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [targetUrl] };
  }

  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', targetUrl] };
  }

  if (process.platform === 'linux') {
    return { command: 'xdg-open', args: [targetUrl] };
  }

  return null;
}

function parseArgs(args) {
  const options = { ...DEFAULTS, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument) {
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--no-open') {
      options.openBrowser = false;
      continue;
    }

    if (!argument.startsWith('--') && !options._urlProvided) {
      options.url = argument;
      options._urlProvided = true;
      continue;
    }

    const nextValue = args[index + 1];

    if (argument === '--url') {
      options.url = requireValue(argument, nextValue);
      options._urlProvided = true;
      index += 1;
      continue;
    }

    if (argument === '--api-base-url') {
      options.apiBaseUrl = requireValue(argument, nextValue);
      index += 1;
      continue;
    }

    if (argument === '--poll-interval-ms') {
      options.pollIntervalMs = parsePositiveInteger(argument, requireValue(argument, nextValue));
      index += 1;
      continue;
    }

    if (argument === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(argument, requireValue(argument, nextValue));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  delete options._urlProvided;
  return options;
}

function requireValue(flag, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parsePositiveInteger(flag, value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer, received ${value}`);
  }

  return parsed;
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function createDefaultUrl() {
  return `https://example.com/?run=${Date.now()}`;
}

function delay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function printHelp() {
  process.stdout.write(`Usage: pnpm simulate:scrape [url] [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --url <value>               Target URL to scrape\n`);
  process.stdout.write(`  --api-base-url <value>      API base URL (default: ${DEFAULTS.apiBaseUrl})\n`);
  process.stdout.write(`  default url                 Fresh https://example.com/?run=<timestamp>\n`);
  process.stdout.write(`  --poll-interval-ms <value>  Polling interval in milliseconds (default: ${DEFAULTS.pollIntervalMs})\n`);
  process.stdout.write(`  --timeout-ms <value>        Overall timeout in milliseconds (default: ${DEFAULTS.timeoutMs})\n`);
  process.stdout.write(`  --no-open                   Do not open the browser automatically\n`);
  process.stdout.write(`  -h, --help                  Show this help text\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
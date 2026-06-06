#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const DEFAULTS = {
  apiBaseUrl: 'http://localhost:3000',
  url: createDefaultUrl(),
  pollIntervalMs: 2000,
  timeoutMs: 5 * 60 * 1000,
  openBrowser: true,
  stress: false,
  jobCount: 100,
  submitConcurrency: 10,
  urlPaddingBytes: 0,
  summaryJson: false,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl);

  if (options.stress) {
    await runStressScenario(apiBaseUrl, options);
    return;
  }

  await runSingleScenario(apiBaseUrl, options);
}

async function runSingleScenario(apiBaseUrl, options) {
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
    onStatus: (snapshot) => renderStatusLine(snapshot, startedAt),
    metrics: null,
  });

    process.stdout.write(`\nFinal status: ${job.job.status}\n`);

    if (job.job.status === 'FAILED') {
      const failureMessage = job.job.errorMessage || 'The scrape job failed without an error message.';
    throw new Error(failureMessage);
  }

    const browserUrl = getBrowserResultUrl(apiBaseUrl, job.job.jobId);
    const accessView = await getCompletedResultUrl(apiBaseUrl, job.job.jobId);

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

async function runStressScenario(apiBaseUrl, options) {
  const startedAt = Date.now();
  const urlFactory = await createStressUrlFactory(options);
  const metrics = createStressMetrics(options.jobCount);

  process.stdout.write(
    [
      `Starting durability run against ${apiBaseUrl}`,
      `jobs=${options.jobCount}`,
      `submitConcurrency=${options.submitConcurrency}`,
      `pollIntervalMs=${options.pollIntervalMs}`,
      `timeoutMs=${options.timeoutMs}`,
      `urlPaddingBytes=${options.urlPaddingBytes}`,
    ].join(' ') + '\n',
  );

  const progressTimer = setInterval(() => {
    renderStressProgress(metrics, startedAt, options.jobCount);
  }, 1000);

  try {
    await runPool(
      Array.from({ length: options.jobCount }, (_, index) => index),
      options.submitConcurrency,
      async (jobIndex) => {
        const targetUrl = urlFactory(jobIndex);
        await executeStressJob({
          apiBaseUrl,
          jobIndex,
          targetUrl,
          pollIntervalMs: options.pollIntervalMs,
          timeoutMs: options.timeoutMs,
          metrics,
        });
      },
    );
  } finally {
    clearInterval(progressTimer);
  }

  renderStressProgress(metrics, startedAt, options.jobCount);
  process.stdout.write('\n');

  const summary = buildStressSummary(metrics, startedAt);

  if (options.summaryJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printStressSummary(summary);
  }

  if (summary.failedJobs > 0 || summary.timedOutJobs > 0 || summary.submitErrors > 0) {
    process.exitCode = 1;
  }
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
  onStatus,
  metrics,
}) {
  let pollCount = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    const job = await getJobStatus(apiBaseUrl, jobId);
    pollCount += 1;

    if (metrics) {
      metrics.statusRequests += 1;
    }

    if (onStatus) {
      onStatus(job);
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return { job, pollCount };
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

async function executeStressJob({
  apiBaseUrl,
  jobIndex,
  targetUrl,
  pollIntervalMs,
  timeoutMs,
  metrics,
}) {
  const startedAt = Date.now();

  try {
    const acknowledgement = await submitScrapeRequest(apiBaseUrl, targetUrl);
    metrics.acceptedJobs += 1;

    const terminalState = await waitForCompletion({
      apiBaseUrl,
      jobId: acknowledgement.jobId,
      pollIntervalMs,
      timeoutMs,
      startedAt,
      onStatus: null,
      metrics,
    });

    const durationMs = Date.now() - startedAt;
    metrics.completedRuns += 1;
    metrics.totalDurationMs += durationMs;
    metrics.maxDurationMs = Math.max(metrics.maxDurationMs, durationMs);
    metrics.durationsMs.push(durationMs);
      metrics.totalPolls += terminalState.pollCount;

    if (terminalState.job.status === 'COMPLETED') {
      metrics.completedJobs += 1;
      return;
    }

    metrics.failedJobs += 1;
    metrics.failures.push({
      jobIndex,
      jobId: acknowledgement.jobId,
      url: targetUrl,
        reason: terminalState.job.errorMessage || 'Job reported FAILED without an error message.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.startsWith('Timed out waiting for job')) {
      metrics.timedOutJobs += 1;
    } else {
      metrics.submitErrors += 1;
    }

    metrics.failures.push({
      jobIndex,
      url: targetUrl,
      reason: message,
    });
  }
}

function createStressMetrics(totalJobs) {
  return {
    totalJobs,
    acceptedJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    timedOutJobs: 0,
    submitErrors: 0,
    completedRuns: 0,
    statusRequests: 0,
    totalPolls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    durationsMs: [],
    failures: [],
  };
}

function renderStressProgress(metrics, startedAt, totalJobs) {
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const settledJobs =
    metrics.completedJobs + metrics.failedJobs + metrics.timedOutJobs + metrics.submitErrors;
  const activeJobs = Math.max(totalJobs - settledJobs, 0);

  process.stdout.write(
    [
      `[${elapsedSeconds}s]`,
      `accepted=${metrics.acceptedJobs}/${totalJobs}`,
      `completed=${metrics.completedJobs}`,
      `failed=${metrics.failedJobs}`,
      `timedOut=${metrics.timedOutJobs}`,
      `submitErrors=${metrics.submitErrors}`,
      `active=${activeJobs}`,
      `statusRequests=${metrics.statusRequests}`,
    ].join(' ') + '\n',
  );
}

function buildStressSummary(metrics, startedAt) {
  const totalElapsedMs = Date.now() - startedAt;
  const averageDurationMs = metrics.completedRuns === 0
    ? 0
    : Math.round(metrics.totalDurationMs / metrics.completedRuns);

  return {
    totalJobs: metrics.totalJobs,
    acceptedJobs: metrics.acceptedJobs,
    completedJobs: metrics.completedJobs,
    failedJobs: metrics.failedJobs,
    timedOutJobs: metrics.timedOutJobs,
    submitErrors: metrics.submitErrors,
    statusRequests: metrics.statusRequests,
    averagePollsPerCompletedJob: metrics.completedRuns === 0
      ? 0
      : roundToTwo(metrics.totalPolls / metrics.completedRuns),
    averageDurationMs,
    p95DurationMs: calculatePercentile(metrics.durationsMs, 95),
    maxDurationMs: metrics.maxDurationMs,
    throughputJobsPerMinute: totalElapsedMs === 0
      ? 0
      : roundToTwo((metrics.completedJobs / totalElapsedMs) * 60000),
    totalElapsedMs,
    failures: metrics.failures.slice(0, 20),
    omittedFailures: Math.max(metrics.failures.length - 20, 0),
  };
}

function printStressSummary(summary) {
  process.stdout.write('Summary\n');
  process.stdout.write(`  totalJobs: ${summary.totalJobs}\n`);
  process.stdout.write(`  acceptedJobs: ${summary.acceptedJobs}\n`);
  process.stdout.write(`  completedJobs: ${summary.completedJobs}\n`);
  process.stdout.write(`  failedJobs: ${summary.failedJobs}\n`);
  process.stdout.write(`  timedOutJobs: ${summary.timedOutJobs}\n`);
  process.stdout.write(`  submitErrors: ${summary.submitErrors}\n`);
  process.stdout.write(`  statusRequests: ${summary.statusRequests}\n`);
  process.stdout.write(`  averagePollsPerCompletedJob: ${summary.averagePollsPerCompletedJob}\n`);
  process.stdout.write(`  averageDurationMs: ${summary.averageDurationMs}\n`);
  process.stdout.write(`  p95DurationMs: ${summary.p95DurationMs}\n`);
  process.stdout.write(`  maxDurationMs: ${summary.maxDurationMs}\n`);
  process.stdout.write(`  throughputJobsPerMinute: ${summary.throughputJobsPerMinute}\n`);
  process.stdout.write(`  totalElapsedMs: ${summary.totalElapsedMs}\n`);

  if (summary.failures.length === 0) {
    return;
  }

  process.stdout.write('  sampledFailures:\n');

  for (const failure of summary.failures) {
    const jobIdPart = failure.jobId ? ` jobId=${failure.jobId}` : '';
    process.stdout.write(
      `    jobIndex=${failure.jobIndex}${jobIdPart} reason=${failure.reason} url=${failure.url}\n`,
    );
  }

  if (summary.omittedFailures > 0) {
    process.stdout.write(`    ... ${summary.omittedFailures} more failure(s) omitted\n`);
  }
}

function calculatePercentile(values, percentile) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );

  return sorted[position];
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

async function createStressUrlFactory(options) {
  if (options.urlsFile) {
    const urls = await loadUrlsFromFile(options.urlsFile);

    if (urls.length === 0) {
      throw new Error(`No URLs found in ${options.urlsFile}`);
    }

    return (jobIndex) => applyUrlPadding(urls[jobIndex % urls.length], options.urlPaddingBytes);
  }

  if (options.urlTemplate) {
    return (jobIndex) => applyUrlPadding(
      fillUrlTemplate(options.urlTemplate, {
        job: String(jobIndex + 1),
        index: String(jobIndex),
        timestamp: String(Date.now()),
      }),
      options.urlPaddingBytes,
    );
  }

  return (jobIndex) => applyUrlPadding(addDefaultQueryParams(options.url, jobIndex), options.urlPaddingBytes);
}

async function loadUrlsFromFile(filePath) {
  const content = await readFile(filePath, 'utf8');

  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function fillUrlTemplate(template, values) {
  return template
    .replaceAll('{job}', values.job)
    .replaceAll('{index}', values.index)
    .replaceAll('{timestamp}', values.timestamp);
}

function addDefaultQueryParams(baseUrl, jobIndex) {
  const url = new URL(baseUrl);
  url.searchParams.set('run', String(Date.now()));
  url.searchParams.set('job', String(jobIndex + 1));
  return url.toString();
}

function applyUrlPadding(targetUrl, paddingBytes) {
  if (paddingBytes <= 0) {
    return targetUrl;
  }

  const url = new URL(targetUrl);
  url.searchParams.set('pad', 'x'.repeat(paddingBytes));
  return url.toString();
}

async function runPool(items, concurrency, worker) {
  const activeWorkers = new Set();

  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    activeWorkers.add(task);

    task.finally(() => {
      activeWorkers.delete(task);
    });

    if (activeWorkers.size >= concurrency) {
      await Promise.race(activeWorkers);
    }
  }

  await Promise.all(activeWorkers);
}

function parseArgs(args) {
  const options = { ...DEFAULTS, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument) {
      continue;
    }

    if (argument === '--') {
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--stress') {
      options.stress = true;
      options.openBrowser = false;
      continue;
    }

    if (argument === '--no-open') {
      options.openBrowser = false;
      continue;
    }

    if (argument === '--summary-json') {
      options.summaryJson = true;
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

    if (argument === '--jobs') {
      options.jobCount = parsePositiveInteger(argument, requireValue(argument, nextValue));
      index += 1;
      continue;
    }

    if (argument === '--submit-concurrency') {
      options.submitConcurrency = parsePositiveInteger(argument, requireValue(argument, nextValue));
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

    if (argument === '--urls-file') {
      options.urlsFile = requireValue(argument, nextValue);
      index += 1;
      continue;
    }

    if (argument === '--url-template') {
      options.urlTemplate = requireValue(argument, nextValue);
      index += 1;
      continue;
    }

    if (argument === '--url-padding-bytes') {
      options.urlPaddingBytes = parseNonNegativeInteger(argument, requireValue(argument, nextValue));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.urlsFile && options.urlTemplate) {
    throw new Error('Use either --urls-file or --url-template, not both.');
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

function parseNonNegativeInteger(flag, value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer, received ${value}`);
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
  process.stdout.write('Usage:\n');
  process.stdout.write('  pnpm simulate:scrape [url] [options]\n');
  process.stdout.write('  pnpm stress:scrape -- [options]\n\n');
  process.stdout.write('Single-job options:\n');
  process.stdout.write(`  --url <value>               Target URL to scrape\n`);
  process.stdout.write(`  --api-base-url <value>      API base URL (default: ${DEFAULTS.apiBaseUrl})\n`);
  process.stdout.write(`  default url                 Fresh https://example.com/?run=<timestamp>\n`);
  process.stdout.write(`  --poll-interval-ms <value>  Polling interval in milliseconds (default: ${DEFAULTS.pollIntervalMs})\n`);
  process.stdout.write(`  --timeout-ms <value>        Overall timeout in milliseconds (default: ${DEFAULTS.timeoutMs})\n`);
  process.stdout.write(`  --no-open                   Do not open the browser automatically\n\n`);
  process.stdout.write('Stress options:\n');
  process.stdout.write('  --stress                    Enable durability mode\n');
  process.stdout.write(`  --jobs <value>              Number of jobs to submit (default: ${DEFAULTS.jobCount})\n`);
  process.stdout.write(`  --submit-concurrency <n>    Max concurrent submit+poll workers (default: ${DEFAULTS.submitConcurrency})\n`);
  process.stdout.write('  --url-template <value>      URL template supporting {job}, {index}, {timestamp}\n');
  process.stdout.write('  --urls-file <path>          Newline-delimited URLs to cycle through\n');
  process.stdout.write(`  --url-padding-bytes <n>     Append a pad query string of this size (default: ${DEFAULTS.urlPaddingBytes})\n`);
  process.stdout.write('  --summary-json              Print the final stress summary as JSON\n\n');
  process.stdout.write('General:\n');
  process.stdout.write('  -h, --help                  Show this help text\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
import { setTimeout as delay } from 'node:timers/promises';

import { Inject, Injectable } from '@nestjs/common';

export interface PollingWorkerOptions {
  pollIntervalMs: number;
}

export const POLLING_WORKER_OPTIONS = Symbol('POLLING_WORKER_OPTIONS');

export interface IPollingWorker {
  start(task: () => Promise<void>): void;
  stop(): Promise<void>;
}

@Injectable()
export class PollingWorker implements IPollingWorker {
  private pollLoopPromise: Promise<void> | null = null;
  private activeTaskPromise: Promise<void> | null = null;
  private pollDelayAbortController: AbortController | null = null;
  private taskInFlight = false;
  private shutdownRequested = false;
  private task: (() => Promise<void>) | null = null;

  constructor(
    @Inject(POLLING_WORKER_OPTIONS)
    private readonly options: PollingWorkerOptions,
  ) {}

  start(task: () => Promise<void>): void {
    if (this.pollLoopPromise) {
      return;
    }

    this.task = task;
    this.shutdownRequested = false;
    this.pollLoopPromise = this.runPollLoop();
  }

  async stop(): Promise<void> {
    this.shutdownRequested = true;
    this.pollDelayAbortController?.abort();

    await Promise.all([
      this.pollLoopPromise,
      this.activeTaskPromise,
    ]);

    this.pollLoopPromise = null;
    this.activeTaskPromise = null;
    this.task = null;
  }

  private async runPollLoop(): Promise<void> {
    while (!this.shutdownRequested) {
      await this.runTask();

      if (this.shutdownRequested) {
        return;
      }

      this.pollDelayAbortController = new AbortController();

      try {
        await delay(this.options.pollIntervalMs, undefined, {
          signal: this.pollDelayAbortController.signal,
        });
      } catch (error: unknown) {
        if (!isAbortError(error) || !this.shutdownRequested) {
          throw error;
        }

        return;
      } finally {
        this.pollDelayAbortController = null;
      }
    }
  }

  private async runTask(): Promise<void> {
    if (this.taskInFlight || !this.task) {
      return;
    }

    this.taskInFlight = true;
    this.activeTaskPromise = this.task();

    try {
      await this.activeTaskPromise;
    } finally {
      this.activeTaskPromise = null;
      this.taskInFlight = false;
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
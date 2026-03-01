import { LifecycleManager } from './lifecycle.js';
import type { LifecycleResult } from './lifecycle.js';

export interface CronOptions {
  intervalMs?: number;  // default: 24 * 60 * 60 * 1000 (daily)
  lifecycle: LifecycleManager;
  onCycle?: (result: LifecycleResult) => void;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export class LifecycleCron {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly options: CronOptions;

  constructor(options: CronOptions) {
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    const interval = this.options.intervalMs ?? ONE_DAY_MS;
    this.timer = setInterval(() => {
      const result = this.runOnce();
      this.options.onCycle?.(result);
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  runOnce(): LifecycleResult {
    return this.options.lifecycle.run();
  }
}

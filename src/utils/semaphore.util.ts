/**
 * Semaphore utility for limiting concurrent operations
 * Helps prevent WebSocket race conditions by controlling concurrency
 */
export class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(initialPermits: number) {
    this.permits = initialPermits;
  }

  /**
   * Acquire a permit (blocks if none available)
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.waitQueue.push(resolve);
      }
    });
  }

  /**
   * Release a permit (unblocks waiting operations)
   */
  release(): void {
    this.permits++;

    const waitingResolve = this.waitQueue.shift();
    if (waitingResolve) {
      this.permits--;
      waitingResolve();
    }
  }

  /**
   * Execute an operation with automatic acquire/release
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  /**
   * Get current available permits
   */
  availablePermits(): number {
    return this.permits;
  }

  /**
   * Get number of waiting operations
   */
  queueLength(): number {
    return this.waitQueue.length;
  }
}

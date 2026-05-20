/**
 * A tiny concurrency limiter. Wraps async operations so at most `max` of them
 * run simultaneously; the rest queue and dispatch as slots free up.
 *
 * Used to fan out Nano Banana / Higgsfield generations from the "Generate all"
 * button without slamming the API past its concurrent-job limit — anything over
 * the cap waits in line and dispatches the instant a slot opens.
 */
export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly queued: number;
}

export function createLimiter(maxConcurrent: number): Limiter {
  let active = 0;
  const waiters: (() => void)[] = [];

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve();
    }
    // At cap — wait for someone to release. Release will resolve us and we
    // inherit their slot (so we don't increment again).
    return new Promise<void>((resolve) => waiters.push(resolve));
  }

  function release() {
    const next = waiters.shift();
    if (next) {
      // Hand the slot directly to the next waiter — keep `active` unchanged.
      next();
    } else {
      active--;
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() { return active; },
    get queued() { return waiters.length; },
  };
}

/**
 * Shared limiter for all Higgsfield image-generation calls.
 *
 * Each color in NB Step 5 fires 4 parallel calls (one per step format 11-14),
 * so e.g. 6 colors = 24 simultaneous generations if uncapped. The cap below
 * is the most we'll have in-flight at once; anything beyond waits its turn
 * and dispatches the instant a slot frees.
 *
 * Tune by changing this single number.
 */
export const MAX_CONCURRENT_HIGGSFIELD = 8;
export const higgsfieldQueue = createLimiter(MAX_CONCURRENT_HIGGSFIELD);

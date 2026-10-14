/** Thrown out of every pending `sleep` when the clock stops; a script ends by not catching it. */
export class Stopped extends Error {
  override readonly name = "Stopped";
}

type Sleeper = {
  remaining: number;
  since: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  resolve: () => void;
  reject: (error: Stopped) => void;
};

/**
 * Scene time. A script awaits `sleep`, which counts only while the clock runs: offscreen the scene
 * holds wherever it is and picks up from the same moment, rather than catching up in a rush.
 */
export class Clock {
  #running = false;
  #stopped = false;
  #sleepers = new Set<Sleeper>();

  get stopped(): boolean {
    return this.#stopped;
  }

  sleep(ms: number): Promise<void> {
    if (this.#stopped) return Promise.reject(new Stopped());
    return new Promise<void>((resolve, reject) => {
      const sleeper: Sleeper = { remaining: Math.max(0, ms), since: 0, timer: undefined, resolve, reject };
      this.#sleepers.add(sleeper);
      if (this.#running) this.#arm(sleeper);
    });
  }

  /** Resolves once the clock is running, at once if it is; rejects once it stops. */
  async running(): Promise<void> {
    await this.sleep(0);
  }

  run(): void {
    if (this.#running || this.#stopped) return;
    this.#running = true;
    for (const sleeper of this.#sleepers) this.#arm(sleeper);
  }

  pause(): void {
    if (!this.#running) return;
    this.#running = false;
    const now = performance.now();
    for (const sleeper of this.#sleepers) {
      clearTimeout(sleeper.timer);
      sleeper.remaining = Math.max(0, sleeper.remaining - (now - sleeper.since));
    }
  }

  stop(): void {
    if (this.#stopped) return;
    this.pause();
    this.#stopped = true;
    for (const sleeper of this.#sleepers) sleeper.reject(new Stopped());
    this.#sleepers.clear();
  }

  #arm(sleeper: Sleeper): void {
    sleeper.since = performance.now();
    sleeper.timer = setTimeout(() => {
      this.#sleepers.delete(sleeper);
      sleeper.resolve();
    }, sleeper.remaining);
  }
}

// A run of the bird's script, which can be cut short: every wait in it ends at once, and the
// script stops at its next step.
class Cancelled extends Error {}

/** One run of the script: the intro, or a hop; `cancel()` ends it at its next step. */
export class Run {
  private cancelled = false;
  private timers = new Set<number>();
  private wakes = new Set<() => void>();

  cancel() {
    this.cancelled = true;
    for (const t of this.timers) clearTimeout(t);
    for (const wake of this.wakes) wake();
    this.timers.clear();
    this.wakes.clear();
  }

  check() {
    if (this.cancelled) throw new Cancelled();
  }

  wait(ms: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const wake = () => reject(new Cancelled());
      const t = window.setTimeout(() => {
        this.timers.delete(t);
        this.wakes.delete(wake);
        resolve();
      }, ms);
      this.timers.add(t);
      this.wakes.add(wake);
    });
  }
}

/** Ends a hop or the intro that was cancelled; anything else is a real error. */
export function ignoreCancelled(error: unknown) {
  if (!(error instanceof Cancelled)) throw error;
}

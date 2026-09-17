// A one-process pub/sub for everything the UI wants to hear about without asking: file changes
// from the watcher, finished runs from the registry, workspace roots when settings change.
// Deliberately tiny — no ordering guarantees beyond "listeners run in registration order", no
// buffering, and a listener that throws can never take the emitter down with it.

import type { ServerEvent } from "@perch/protocol";

export type ServerEventListener = (event: ServerEvent) => void;

export class EventBus {
  private readonly listeners = new Set<ServerEventListener>();

  on(listener: ServerEventListener): void {
    this.listeners.add(listener);
  }

  off(listener: ServerEventListener): void {
    this.listeners.delete(listener);
  }

  /** `on` plus the matching `off`, so callers can clean up without keeping the function around. */
  subscribe(listener: ServerEventListener): () => void {
    this.on(listener);
    return () => this.off(listener);
  }

  emit(event: ServerEvent): void {
    // Copied first: a listener may unsubscribe itself while we are delivering.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error("[perch] event listener failed", err);
      }
    }
  }
}

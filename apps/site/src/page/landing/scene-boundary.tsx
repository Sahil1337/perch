import { Component, type ReactNode } from "react";

/** A scene that fails to load or throws leaves the copy standing on the page's sky. */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.warn("The landing scene could not start; the page goes on without it.", error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

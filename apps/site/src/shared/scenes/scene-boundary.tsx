import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Logged with the error when the scene fails; quiet without it. */
  warn?: string;
};

/** A scene that fails to load or throws renders nothing rather than taking the page down with it. */
export class SceneBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    if (this.props.warn) console.warn(this.props.warn, error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

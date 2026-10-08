"use client";
import React from "react";
import { Loader2 } from "lucide-react";

type Props = { children: React.ReactNode; fallback: React.ReactNode; retries?: number; delayMs?: number };
type State = { error: Error | null; attempt: number };

/**
 * Error boundary for a page that can crash for a moment while fresh data settles (a coin that was launched seconds ago).
 * It shows the spinner and re-mounts the children a few times, a little later each time, and only then gives up and
 * shows the fallback. Every failure is logged so a repeat can be diagnosed.
 */
export class RecoveringBoundary extends React.Component<Props, State> {
  state: State = { error: null, attempt: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[RecoveringBoundary]", error, info.componentStack);
    const { retries = 3, delayMs = 1200 } = this.props;
    if (this.state.attempt >= retries) return;
    this.timer = setTimeout(() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 })), delayMs * (this.state.attempt + 1));
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.state.attempt >= (this.props.retries ?? 3)) return this.props.fallback;
    return <div className="grid min-h-[65vh] place-items-center" role="status" aria-label="Loading market"><Loader2 className="size-6 animate-spin text-emerald-300" /></div>;
  }
}

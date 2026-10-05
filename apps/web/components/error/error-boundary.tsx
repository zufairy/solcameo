"use client";

import React from "react";
import { ErrorState } from "./error-state";

interface Props {
  children: React.ReactNode;
  /** Optional compact variant for panel-level boundaries */
  compact?: boolean;
  /** Custom fallback instead of default ErrorState */
  fallback?: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React class-based Error Boundary. Catches render/lifecycle errors in the
 * subtree and shows ErrorState instead of white-screening.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      // Check `!== undefined` (not truthiness) so an explicit `fallback={null}`
      // suppresses the error UI entirely — e.g. an isolated background worker
      // whose failure should render NOTHING, not the default error card.
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <ErrorState
          error={this.state.error}
          onRetry={this.handleRetry}
          compact={this.props.compact}
        />
      );
    }
    return this.props.children;
  }
}

// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ErrorBoundary } from "./error-boundary";

// Tells React this environment intentionally drives updates via act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// app/layout.tsx imported ErrorBoundary but never rendered it, so an
// uncaught render error in any route blanked the whole app (white screen).
// This proves the boundary itself actually catches a render-phase throw and
// shows a fallback with a way out, rather than letting the error propagate
// — the mechanism the root layout now relies on.

function Bomb(): React.ReactElement {
  throw new Error("boom");
}

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return container;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the fallback instead of letting a child's render error propagate", () => {
    // componentDidCatch intentionally logs — silence it so the test output
    // stays clean without hiding a real assertion failure.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const container = mount(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    // The default fallback (ErrorState) renders, not the thrown error.
    expect(container.textContent).toContain("Something went wrong");
    // ... and it offers a way out, not a dead end.
    expect(container.textContent).toContain("Try again");
  });

  it("renders a custom fallback when one is provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const container = mount(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <Bomb />
      </ErrorBoundary>
    );

    expect(container.textContent).toBe("custom fallback");
  });

  it("renders children normally when nothing throws", () => {
    const container = mount(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );

    expect(container.textContent).toBe("all good");
  });
});

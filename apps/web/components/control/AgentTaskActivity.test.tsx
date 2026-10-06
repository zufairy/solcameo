// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AgentTaskActivity } from "./AgentTaskActivity";

const query = vi.hoisted(() => ({ tasks: undefined as undefined | Record<string, unknown>[], args: {} as Record<string, unknown> }));
vi.mock("convex/react", () => ({ useQuery: (_query: unknown, args: Record<string, unknown>) => { query.args = args; return query.tasks; } }));
vi.mock("./ui", () => ({ formatWhen: () => "just now" }));
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); query.tasks = undefined; vi.unstubAllGlobals(); });

it("shows loading, empty, and live task completion for the selected agent", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  const render = () => act(async () => root.render(<AgentTaskActivity mintAddress="agent-mint" />));
  await render();
  expect(query.args).toEqual({ mintAddress: "agent-mint", limit: 30 });
  expect(host.textContent).toContain("Loading tasks");
  query.tasks = []; await render();
  expect(host.textContent).toContain("No tasks yet");
  query.tasks = [{ _id: "task-1", _creationTime: Date.now(), title: "Posted a video", status: "running" }];
  await render();
  expect(host.textContent).toContain("Working");
  query.tasks = [{ ...query.tasks[0], status: "succeeded", completedAt: Date.now() }];
  await render();
  expect(host.textContent).toContain("Done");
  expect(host.textContent).toContain("1 done");
  expect(host.textContent).not.toContain("Working");
  expect(host.textContent).not.toContain("Heartbeat");
});

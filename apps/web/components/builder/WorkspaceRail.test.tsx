// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Home, Film, Video } from "lucide-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRail } from "./WorkspaceRail";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const tabs = [
  { id: "home", label: "Home", icon: Home },
  { id: "director", label: "Director", icon: Film },
  { id: "videos", label: "Videos", icon: Video },
] as const;

it("renders icon-only buttons with accessible names and selects tabs", async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(<WorkspaceRail tabs={[...tabs]} active="home" onSelect={onSelect} locked={false} />));
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Home", "Director", "Videos"]);
  expect(buttons[0].getAttribute("aria-current")).toBe("page");
  await act(async () => buttons[2].click());
  expect(onSelect).toHaveBeenCalledWith("videos");
});

it("bounces locked tabs back to Home", async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(<WorkspaceRail tabs={[...tabs]} active="home" onSelect={onSelect} locked />));
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons[1].getAttribute("aria-label")).toBe("Director (locked)");
  await act(async () => buttons[1].click());
  expect(onSelect).toHaveBeenCalledWith("home");
});

// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ tick: vi.fn(), sound: true }));
vi.mock("./uiSound", () => ({ playUiTick: m.tick }));
vi.mock("./soundPreference", () => ({ useSoundPreference: () => ({ muted: !m.sound, soundOn: m.sound, setSound: vi.fn() }) }));
import { useClickFeedback } from "./useClickFeedback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Page() {
  useClickFeedback();
  return (<div><header><button id="menu">menu</button></header><button id="pick">Pick</button><button id="off" disabled>Off</button><p id="text">text</p></div>);
}
let host: HTMLDivElement, root: Root;
const press = (id: string, init: PointerEventInit = {}) => act(() => { document.getElementById(id)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...init })); });
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); act(() => root.render(<Page />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); m.sound = true; });

it("ticks and animates a pressed control", () => {
  press("pick");
  expect(m.tick).toHaveBeenCalledTimes(1);
  expect(document.getElementById("pick")!.classList.contains("ui-pop")).toBe(true);
});
it("stays silent for disabled controls, plain text and the header menu", () => {
  press("off"); press("text"); press("menu");
  expect(m.tick).not.toHaveBeenCalled();
});
it("counts a pointer press and its click once", () => {
  press("pick");
  act(() => { document.getElementById("pick")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })); });
  expect(m.tick).toHaveBeenCalledTimes(1);
});
it("animates but stays quiet when sound is off", () => {
  m.sound = false;
  act(() => root.render(<Page />));
  press("pick");
  expect(m.tick).not.toHaveBeenCalled();
  expect(document.getElementById("pick")!.classList.contains("ui-pop")).toBe(true);
});

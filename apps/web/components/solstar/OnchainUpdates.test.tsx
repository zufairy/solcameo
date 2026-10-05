// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({onLogs:vi.fn(),removeOnLogsListener:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@solana/wallet-adapter-react",()=>({useConnection:()=>({connection:mock})}));
vi.mock("convex/react",()=>({useQuery:()=>[{dbcPool:"dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"}]}));
import { OnchainUpdates } from "./OnchainUpdates";
it("coalesces confirmed updates and cleans up subscriptions", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  let notify: (value:{err:unknown})=>void = ()=>{};
  mock.onLogs.mockImplementation((_address,callback)=>{notify=callback;return 42;});
  const host=document.createElement("div"); const root=createRoot(host);const listener=vi.fn();window.addEventListener("solcameo:trade-confirmed",listener);
  await act(async()=>root.render(<OnchainUpdates/>));
  notify({err:null});notify({err:null});notify({err:{failed:true}});
  await act(async()=>vi.advanceTimersByTime(750));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(mock.onLogs.mock.calls[0][2]).toBe("confirmed");
  await act(async()=>root.unmount());
  expect(mock.removeOnLogsListener).toHaveBeenCalledWith(42);
  window.removeEventListener("solcameo:trade-confirmed",listener);vi.useRealTimers();vi.unstubAllGlobals();
});

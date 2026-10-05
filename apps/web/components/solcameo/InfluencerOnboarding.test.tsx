// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ push: vi.fn(), login: vi.fn(), signed: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ authenticated: true, login: mocks.login }) }));
vi.mock("@/lib/client/siwsIdentity", () => ({ ensureSiwsViaRegistered: mocks.signed }));
vi.mock("@/components/builder/character/CharacterTab", () => ({ CharacterTab: ({ onCharacterReady }: { onCharacterReady: (value: unknown) => void }) => <button onClick={() => onCharacterReady({ version: 1, image: { url: "https://images.example/portrait.jpg", model: "soul2" }, candidates: [], selection: {}, tier: "normal", model: "soul2", prompt: "Original character", updatedAt: 1 })}>Use generated portrait</button> }));
vi.mock("./LiveDbcLaunch", () => ({ LiveDbcLaunch: () => <button>Approve on-chain mint</button> }));
vi.mock("./DbcEconomics", () => ({ DbcEconomics: () => <div>Curve economics</div> }));
import { InfluencerOnboarding } from "./InfluencerOnboarding";
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.setItem("solcameo-influencer-draft-v2", JSON.stringify({ concept: { name: "Orbit Muse", ticker: "ORBIT", bio: "A space creator", category: "Comedy" } }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<InfluencerOnboarding liveReadiness={{ready:true,reason:"Devnet launch"}} />); });
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.trim() === text);
  if (!button) throw new Error(`Missing button ${text}`);
  await act(async () => { button.click(); });
}
describe("character-first coin creation", () => {
  it("requires a selected portrait, review and image rights before sending creation requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ imageStorageId: "storage123" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ characterId: "character123" }) });
    vi.stubGlobal("fetch", fetchMock); mocks.signed.mockResolvedValue("signed-session");
    await mount();
    expect(host.querySelector("button[disabled]")?.textContent).toContain("Coin details");
    await click("Use generated portrait");
    expect(host.textContent).toContain("Give your character a coin.");
    await click("Configure curve"); await click("Review launch");
    const create = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Prepare live launch"))!;
    expect(create.disabled).toBe(true); expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { (host.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    await click("Prepare live launch");
    expect(mocks.signed).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ name: "Orbit Muse", ticker: "ORBIT", imageStorageId: "storage123", rightsAttested: true });
    expect(mocks.push).not.toHaveBeenCalled(); expect(host.textContent).toContain("Approve");
  });
  it("does not create a coin when wallet verification is refused", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); mocks.signed.mockResolvedValue(null);
    await mount(); await click("Use generated portrait"); await click("Configure curve"); await click("Review launch");
    await act(async () => { (host.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    await click("Prepare live launch");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("approve the sign-in message");
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  });
});

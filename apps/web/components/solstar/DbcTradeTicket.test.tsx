// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
const m = vi.hoisted(() => ({
  wallet: "",
  login: vi.fn(),
  sign: vi.fn(),
  auth: vi.fn(),
  ensure: vi.fn(),
  fetch: vi.fn(),
  balance: vi.fn(),
  tokens: vi.fn(),
}));
vi.mock("@/hooks/use-solana-wallet", () => ({
  useUnifiedSolanaWallet: () => ({
    publicKey: m.wallet ? { toBase58: () => m.wallet } : null,
    signTransaction: m.wallet ? m.sign : undefined,
    connecting: false,
  }),
}));
vi.mock("@/providers/supabase-auth-provider", () => ({
  useSupabaseAuth: () => ({ login: m.login, getFreshToken: m.auth }),
}));
vi.mock("@/lib/client/useSolUsd", () => ({ useSolUsd: () => null }));
vi.mock("@solana/wallet-adapter-react", () => {
  const connection = {
    getBalance: m.balance,
    getParsedTokenAccountsByOwner: m.tokens,
  };
  return { useConnection: () => ({ connection }) };
});
vi.mock("@/lib/client/siwsIdentity", () => ({
  ensureSiwsViaRegistered: m.ensure,
  getCurrentSiwsToken: () => "proof",
  getCurrentSiwsWallet: () => m.wallet,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    void _variant;
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
import { DbcTradeTicket } from "./DbcTradeTicket";
let root: Root, host: HTMLDivElement;
const owner = Keypair.generate();
const render = async (network = "devnet") => {
  await act(async () =>
    root.render(
      <DbcTradeTicket
        characterId={"coin" as never}
        ticker="TEST"
        network={network}
      />,
    ),
  );
};
const click = async (text: string) => {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", m.fetch);
  vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet");
  sessionStorage.clear();
  m.wallet = owner.publicKey.toBase58();
  m.auth.mockResolvedValue("auth");
  m.ensure.mockResolvedValue("proof");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("opens wallet login when disconnected instead of silently doing nothing", async () => {
  m.wallet = "";
  await render();
  await click("Connect wallet");
  expect(m.login).toHaveBeenCalledOnce();
  expect(m.fetch).not.toHaveBeenCalled();
});
it("explains a network mismatch beside the disabled trade button", async () => {
  await render("mainnet");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "configured for devnet",
  );
  expect(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Market on mainnet",
    )?.disabled,
  ).toBe(true);
});
it("resumes the same signed swap after an ambiguous submission without signing again", async () => {
  const packet = {
    receipt: "reviewed",
    signature: "1".repeat(88),
    transaction: "signed-packet",
  };
  sessionStorage.setItem(
    `solcameo-dbc-trade-devnet-coin-${m.wallet}`,
    JSON.stringify(packet),
  );
  const actions: string[] = [];
  m.fetch.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    actions.push(body.action);
    expect(body.signature).toBe(packet.signature);
    if (body.action === "submit") throw new Error("RPC timeout");
    return { ok: true, json: async () => ({ confirmed: true }) };
  });
  await render();
  await click("Resume pending swap");
  expect(actions).toEqual(["submit", "confirm"]);
  expect(m.sign).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Swap confirmed");
  expect(sessionStorage.length).toBe(0);
});
it("shows wallet verification immediately and signs a fresh trade with explicit auth headers", async () => {
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [],
    }).compileToV0Message(),
  );
  m.sign.mockImplementation(async (packet: VersionedTransaction) => {
    packet.sign([owner]);
    return packet;
  });
  m.fetch.mockImplementation(async (_url, options) => {
    expect(options.headers.Authorization).toBe("Bearer auth");
    expect(options.headers["x-siws-session"]).toBe("proof");
    const body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () =>
        body.action === "prepare"
          ? {
              receipt: "receipt",
              transaction: Buffer.from(tx.serialize()).toString("base64"),
              minimumOut: "1000000",
            }
          : body.action === "confirm"
            ? { confirmed: true }
            : { signature: "sent" },
    };
  });
  await render();
  const input = host.querySelector('input[aria-label="Amount in SOL"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "0.1");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let finishVerification: (value: string) => void = () => {};
  m.ensure.mockReturnValue(
    new Promise<string>((resolve) => {
      finishVerification = resolve;
    }),
  );
  await click("Buy TEST");
  expect(host.textContent).toContain("Verifying your wallet");
  await act(async () => {
    finishVerification("proof");
  });
  expect(m.sign).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Swap confirmed");
});

it("uses the token balance for the sell slider and reserves SOL when choosing buy Max", async () => {
  m.balance.mockResolvedValue(1000000000);
  m.tokens.mockResolvedValue({
    value: [
      {
        account: {
          data: {
            parsed: {
              info: { tokenAmount: { amount: "8000000", decimals: 6 } },
            },
          },
        },
      },
    ],
  });
  await act(async () =>
    root.render(
      <DbcTradeTicket
        characterId={"coin" as never}
        ticker="TEST"
        network="devnet"
        mint={owner.publicKey.toBase58()}
      />,
    ),
  );
  await click("Max");
  expect(
    (
      host.querySelector(
        'input[aria-label="Amount in SOL"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("0.99");
  await click("sell");
  await click("50%");
  expect(
    (
      host.querySelector(
        'input[aria-label="Amount in TEST"]',
      ) as HTMLInputElement
    ).value,
  ).toBe("4");
});

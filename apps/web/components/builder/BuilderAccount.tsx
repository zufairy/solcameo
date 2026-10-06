"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, ChevronDown, Copy, ExternalLink, Loader2, LogOut, RefreshCw, Sparkles, Wallet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useFullSignOut } from "@/providers/wallet-provider";
import { useSolBalance } from "@/components/layout/wallet-button";
import { getAccountExplorerUrl } from "@/lib/solana/network";
import { useAgentWallet } from "./useAgentWallet";
import { AGENT_FUNDING_EVENT, type AgentFundingRequest } from "@/lib/client/agentGenerationFetch";
import { FundAgentDialog } from "./FundAgentDialog";
import { CONNECT_BUTTON_CLASS } from "./connectButton";
import flashAvatar from "@/assets/flash.jpeg";

type Mode = "main" | "agent";
const MODE_KEY = "vello.builder.walletMode";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * One header control for the profile and both balances. The swap button flips the figure between your
 * own wallet and the agent's wallet; the rest of the pill opens the account menu.
 */
export function BuilderAccount({ agentWalletAddress, mintAddress, agentName, ready }: { agentWalletAddress?: string; mintAddress?: string; agentName?: string; ready: boolean }) {
  const router = useRouter();
  const signOut = useFullSignOut();
  const { publicKey } = useUnifiedSolanaWallet();
  const main = publicKey?.toBase58() ?? null;
  const mainSol = useSolBalance(main);
  const agent = useAgentWallet({ address: agentWalletAddress, mintAddress, ready });
  const [mode, setMode] = useState<Mode>("main");
  const [copied, setCopied] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [required, setRequired] = useState<number>();
  useEffect(() => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<AgentFundingRequest>).detail;
      if (request.mintAddress !== mintAddress) return;
      event.preventDefault(); // handled here, so the app-wide gate stays closed
      setRequired(request.required); setFundOpen(true); void agent.refresh();
    };
    window.addEventListener(AGENT_FUNDING_EVENT, listener);
    return () => window.removeEventListener(AGENT_FUNDING_EVENT, listener);
  }, [mintAddress, agent.refresh]);
  useEffect(() => {
    try { if (localStorage.getItem(MODE_KEY) === "agent") setMode("agent"); } catch { /* storage blocked */ }
  }, []);
  const flip = () => {
    const next: Mode = mode === "main" ? "agent" : "main";
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* storage blocked */ }
    if (next === "agent") void agent.refresh();
  };

  const address = mode === "main" ? main : agent.wallet ?? null;
  const value =
    mode === "main"
      ? mainSol == null ? "···" : `${mainSol.toFixed(3)} SOL`
      : agent.funds ? `${agent.funds.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`
        : agent.setupFailed ? "Setup failed" : agent.wallet ? "···" : "Setting up";
  const sub = mode === "agent" && agent.funds ? `${agent.funds.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL` : null;
  const spinning = mode === "agent" && (agent.refreshing || agent.settingUp);

  if (!main) return null;
  return (
    <div className="flex items-center gap-2">
    <button type="button" onClick={() => setFundOpen(true)} title="Move money from your wallet to the agent wallet" className={`${CONNECT_BUTTON_CLASS} h-9 !rounded-[6px] !px-3`}>
      <ArrowRightLeft className="size-3.5" />
      <span className="hidden lg:inline">Add funds</span>
    </button>
    <div className="flex h-9 items-stretch overflow-hidden rounded-[8px] border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_22px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button type="button" className="flex items-center gap-2.5 pl-1.5 pr-2 outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.08]" aria-label="Account menu">
              {/* eslint-disable-next-line @next/next/no-img-element -- bundled avatar */}
              <img src={flashAvatar.src} alt="" className="size-6 rounded-full object-cover ring-1 ring-white/20" />
              <span className="flex flex-col items-start leading-none">
                <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">{mode === "main" ? "Wallet" : "Agent wallet"}</span>
                <span className="mt-1 flex items-baseline gap-1.5 text-[12px] font-semibold tabular-nums">
                  {value}
                  {sub && <span className="text-[10.5px] font-normal text-white/50">{sub}</span>}
                </span>
              </span>
              <ChevronDown className="size-3 text-white/40" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-1.5rem)]">
          <div className="px-2 py-1.5">
            <p className="mb-0.5 text-[11px] text-zinc-500">{mode === "main" ? "Your wallet" : "Agent wallet"}</p>
            <p className="truncate font-mono text-xs text-zinc-300">{address ? short(address) : "Setting up…"}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setFundOpen(true)}><ArrowRightLeft className="mr-2 size-3.5" />Add funds to the agent</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/control")}><Sparkles className="mr-2 size-3.5" />My Influencers</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/wallet")}><Wallet className="mr-2 size-3.5 text-zinc-400" />Wallet</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!address}
            onClick={() => { if (!address) return; void navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}
          >
            {copied ? <Check className="mr-2 size-3.5 text-[#d7ff00]" /> : <Copy className="mr-2 size-3.5 text-zinc-400" />}
            {copied ? "Copied" : "Copy address"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!address} onClick={() => address && window.open(getAccountExplorerUrl(address), "_blank")}>
            <ExternalLink className="mr-2 size-3.5 text-zinc-400" />View on Explorer
          </DropdownMenuItem>
          {agent.setupFailed && mode === "agent" && (
            <DropdownMenuItem onClick={() => void agent.retry()}><RefreshCw className="mr-2 size-3.5" />Retry wallet setup</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-400 focus:text-red-400" onClick={() => void signOut()}><LogOut className="mr-2 size-3.5" />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={flip}
        aria-label={mode === "main" ? "Show the agent wallet balance" : "Show your wallet balance"}
        title={mode === "main" ? "Switch to the agent wallet" : "Switch to your wallet"}
        className="grid w-8 place-items-center border-l border-white/10 text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:bg-white/[0.1]"
      >
        {spinning ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      </button>
    </div>
    <FundAgentDialog open={fundOpen} onOpenChange={setFundOpen} agentWallet={agent.wallet} agentName={agentName} suggestedUsdc={required} />
    </div>
  );
}

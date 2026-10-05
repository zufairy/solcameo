"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCreateAgent } from "@/hooks/use-create-agent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Bot, User, Sparkles, Check, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "assistant" | "user";
  content: string;
}

type BuildStep =
  | "name"
  | "handle"
  | "niche"
  | "language"
  | "description"
  | "warmth"
  | "humor"
  | "authority"
  | "boldness"
  | "preview"
  | "launching"
  | "done";

interface AgentConfig {
  name: string;
  handle: string;
  niche: string;
  language: string;
  description: string;
  personality: { warmth: number; humor: number; authority: number; boldness: number };
}

const STEP_FLOW: BuildStep[] = [
  "name", "handle", "niche", "language",
  "description", "warmth", "humor", "authority", "boldness", "preview",
];

const STEP_QUESTIONS: Record<BuildStep, string> = {
  name: `👋 Let's launch your AI Influencer! What's their **name**?\n\n(e.g. "Aria", "Kai Chen", "ZaraBot")`,
  handle: `Nice! What's the **handle** for your agent?\n\nUse @ format, lowercase only. (e.g. "@aria.ai", "@kai_gen")`,
  niche: `What **niche** best describes your agent?\n\n\`lifestyle\` · \`tech\` · \`fashion\` · \`fitness\` · \`food\` · \`travel\` · \`finance\` · \`gaming\``,
  language: `What **primary language** will your agent post in?\n\n\`en\` · \`ms\` · \`id\` · \`ar\` · \`zh\` · \`hi\``,
  description: `Write a short **bio** — who they are, their vibe, what they post about. (2–3 sentences)`,
  warmth: `Almost done! Let's set the **personality** (each 1–10).\n\n**Warmth** — 1 = cold & analytical · 10 = warm & friendly. What's the score?`,
  humor: `**Humor** — 1 = serious · 10 = total meme lord. Score?`,
  authority: `**Authority** — 1 = casual peer · 10 = expert guru. Score?`,
  boldness: `**Boldness** — 1 = cautious & safe · 10 = provocative & edgy. Last one!`,
  preview: "",
  launching: "",
  done: "",
};

const NICHES = ["lifestyle", "tech", "fashion", "fitness", "food", "travel", "finance", "gaming"];
const LANGUAGES = ["en", "ms", "id", "ar", "zh", "hi", "es", "fr"];

const STEP_LABELS: { key: BuildStep; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "handle", label: "Handle" },
  { key: "niche", label: "Niche" },
  { key: "language", label: "Language" },
  { key: "description", label: "Bio" },
  { key: "warmth", label: "Personality" },
  { key: "preview", label: "Launch" },
];

function parseScore(s: string): number | null {
  const n = parseInt(s.trim(), 10);
  return !isNaN(n) && n >= 1 && n <= 10 ? n : null;
}

function buildPreview(c: AgentConfig): string {
  return [
    `✅ Here's your AI Influencer preview:\n`,
    `**${c.name}** · \`${c.handle}\``,
    `${c.niche} · ${c.language}`,
    `\n_${c.description}_`,
    `\nPersonality: Warmth **${c.personality.warmth}**/10 · Humor **${c.personality.humor}**/10 · Authority **${c.personality.authority}**/10 · Boldness **${c.personality.boldness}**/10`,
    `\nReady to go live? Click **Launch Agent** below.`,
  ].join("\n");
}

function RichText({ text }: { text: string }) {
  const segments = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith("**") && seg.endsWith("**"))
          return <strong key={i}>{seg.slice(2, -2)}</strong>;
        if (seg.startsWith("`") && seg.endsWith("`"))
          return (
            <code key={i} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
              {seg.slice(1, -1)}
            </code>
          );
        if (seg.startsWith("_") && seg.endsWith("_"))
          return <em key={i}>{seg.slice(1, -1)}</em>;
        return seg.split("\n").map((line, j) => (
          <span key={`${i}-${j}`}>
            {j > 0 && <br />}
            {line}
          </span>
        ));
      })}
    </>
  );
}

export function AgentBuilderChat() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const createInfluencer = useCreateAgent();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<BuildStep>("name");
  const [config, setConfig] = useState<Partial<AgentConfig>>({});
  const [launching, setLaunching] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    addBot(STEP_QUESTIONS.name);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addBot(content: string) {
    setMessages((p) => [...p, { id: crypto.randomUUID(), role: "assistant", content }]);
  }
  function addUser(content: string) {
    setMessages((p) => [...p, { id: crypto.randomUUID(), role: "user", content }]);
  }
  function addError(msg: string) {
    addBot(`⚠️ ${msg}`);
  }

  function advance(from: BuildStep, newConfig: Partial<AgentConfig>) {
    const idx = STEP_FLOW.indexOf(from);
    const next = STEP_FLOW[idx + 1] ?? "preview";
    setStep(next);
    if (next !== "preview") {
      setTimeout(() => addBot(STEP_QUESTIONS[next]), 350);
    } else {
      const full = { ...config, ...newConfig } as AgentConfig;
      setConfig(full);
      setTimeout(() => addBot(buildPreview(full)), 350);
    }
  }

  function send() {
    const val = input.trim();
    if (!val || step === "preview" || step === "launching" || step === "done") return;
    addUser(val);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
    process(val);
  }

  function process(val: string) {
    const lo = val.toLowerCase().trim();

    switch (step) {
      case "name":
        if (val.length < 2) { addError("Name must be at least 2 characters."); return; }
        setConfig((c) => ({ ...c, name: val }));
        advance("name", { name: val });
        break;

      case "handle": {
        const h = val.startsWith("@") ? val : `@${val}`;
        if (!/^@[a-z0-9_.]+$/.test(h)) {
          addError("Handle must be lowercase letters, numbers, dots, or underscores.");
          return;
        }
        setConfig((c) => ({ ...c, handle: h }));
        advance("handle", { handle: h });
        break;
      }

      case "niche":
        if (!NICHES.includes(lo)) {
          addError(`Pick one of: ${NICHES.join(" · ")}`);
          return;
        }
        setConfig((c) => ({ ...c, niche: lo }));
        advance("niche", { niche: lo });
        break;

      case "language":
        if (!LANGUAGES.includes(lo)) {
          addError(`Pick one of: ${LANGUAGES.join(" · ")}`);
          return;
        }
        setConfig((c) => ({ ...c, language: lo }));
        advance("language", { language: lo });
        break;

      case "description":
        if (val.length < 20) { addError("Please write at least 20 characters."); return; }
        setConfig((c) => ({ ...c, description: val }));
        advance("description", { description: val });
        break;

      case "warmth": case "humor": case "authority": case "boldness": {
        const n = parseScore(val);
        if (!n) { addError("Enter a number between 1 and 10."); return; }
        const key = step as keyof AgentConfig["personality"];
        setConfig((c) => ({
          ...c,
          personality: { ...(c.personality ?? { warmth: 5, humor: 5, authority: 5, boldness: 5 }), [key]: n },
        }));
        advance(step, {});
        break;
      }
    }
  }

  async function launch() {
    if (!connected || !publicKey) { setVisible(true); return; }
    if (!config.name || !config.handle || !config.niche || !config.language || !config.description || !config.personality) return;
    setLaunching(true);
    setStep("launching");
    addBot("🚀 Minting your AI Influencer on Solana devnet...");
    try {
      const mintAddress = `${config.handle!.replace("@", "")}-${Date.now()}`;
      const avatarUrl = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(config.name!)}&backgroundColor=1a1a2e`;
      const createdMintAddress = await createInfluencer({
        mintAddress,
        creatorWallet: publicKey.toBase58(),
        name: config.name!,
        handle: config.handle!,
        avatarUrl,
        niche: config.niche!,
        language: config.language!,
        archetype: config.niche!,
        description: config.description!,
        personality: config.personality!,
      });
      setStep("done");
      setTimeout(() => {
        addBot(`✅ **${config.name}** is live on the market! Redirecting...`);
        setTimeout(() => router.push(`/builder?mint=${encodeURIComponent(createdMintAddress)}`), 1800);
      }, 400);
    } catch (err) {
      addError(err instanceof Error ? err.message : "Launch failed. Try again.");
      setStep("preview");
      setLaunching(false);
    }
  }

  const isDisabled = step === "preview" || step === "launching" || step === "done";
  const progressPct = (() => {
    const idx = STEP_FLOW.indexOf(step);
    return idx < 0 ? 100 : Math.round((idx / STEP_FLOW.length) * 100);
  })();

  return (
    <div className="flex gap-5 h-[calc(100vh-190px)] min-h-[520px]">
      {/* Chat panel */}
      <div className="flex-1 flex flex-col rounded-xl border border-border bg-card/20 overflow-hidden">
        {/* Progress */}
        <div className="h-0.5 bg-muted/50">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-2.5",
                msg.role === "user" ? "flex-row-reverse" : ""
              )}
            >
              <Avatar className="size-7 border border-border shrink-0 mt-0.5">
                <AvatarFallback
                  className={cn(
                    "text-xs",
                    msg.role === "assistant"
                      ? "bg-emerald-600/20 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <Bot className="size-3.5" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                </AvatarFallback>
              </Avatar>

              <div
                className={cn(
                  "rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[75%]",
                  msg.role === "assistant"
                    ? "bg-muted/40 rounded-tl-none"
                    : "bg-emerald-600/15 border border-emerald-500/20 rounded-tr-none"
                )}
              >
                <RichText text={msg.content} />
              </div>
            </div>
          ))}

          {/* Launch CTA */}
          {step === "preview" && (
            <div className="pl-9">
              {!connected ? (
                <Button
                  onClick={() => setVisible(true)}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Wallet className="size-4" />
                  Connect Wallet to Launch
                </Button>
              ) : (
                <Button
                  onClick={launch}
                  disabled={launching}
                  className="gap-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:opacity-90"
                >
                  {launching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Launch Agent
                </Button>
              )}
            </div>
          )}

          {step === "done" && (
            <div className="pl-9">
              <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 gap-1.5">
                <Check className="size-3" />
                Agent is live
              </Badge>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border/60 p-3 bg-background/20">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              className="flex-1 min-h-[38px] max-h-[120px] resize-none rounded-lg border border-input bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all"
              placeholder={isDisabled ? "All done! 🎉" : "Type your answer…"}
              value={input}
              disabled={isDisabled}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
            />
            <Button
              size="icon"
              onClick={send}
              disabled={isDisabled || !input.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 shrink-0 size-9"
            >
              <Send className="size-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 pl-1">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Right config panel */}
      <div className="w-56 shrink-0 hidden lg:flex flex-col gap-3">
        {/* Steps tracker */}
        <Card className="p-4 border-border bg-card/30">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Progress
          </p>
          <div className="space-y-2">
            {STEP_LABELS.map(({ key, label }) => {
              const currentIdx = STEP_FLOW.indexOf(step);
              const thisIdx = STEP_FLOW.indexOf(key);
              const isPersonality = key === "warmth";
              const personalitySteps: BuildStep[] = ["warmth", "humor", "authority", "boldness"];
              const done =
                currentIdx > Math.max(...(isPersonality ? personalitySteps.map(s => STEP_FLOW.indexOf(s)) : [thisIdx])) ||
                step === "done";
              const active =
                isPersonality
                  ? personalitySteps.includes(step)
                  : step === key;
              return (
                <div key={key} className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "size-4 rounded-full flex items-center justify-center shrink-0 transition-all",
                      done
                        ? "bg-emerald-500/20 text-emerald-400"
                        : active
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-muted/50 text-muted-foreground/30"
                    )}
                  >
                    {done ? (
                      <Check className="size-2.5" />
                    ) : (
                      <div className="size-1.5 rounded-full bg-current" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs transition-colors",
                      done
                        ? "text-emerald-400"
                        : active
                        ? "text-emerald-300 font-medium"
                        : "text-muted-foreground/40"
                    )}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Config preview */}
        <Card className="p-4 border-border bg-card/30 flex-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Agent Config
          </p>
          <div className="space-y-2.5">
            {(
              [
                { label: "Name", value: config.name },
                { label: "Handle", value: config.handle },
                { label: "Niche", value: config.niche },
                { label: "Lang", value: config.language },
              ] as { label: string; value: string | undefined }[]
            ).map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center gap-2">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {label}
                </span>
                {value ? (
                  <span className="text-[11px] font-mono text-foreground font-medium truncate">
                    {value}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground/30">—</span>
                )}
              </div>
            ))}

            {config.personality && (
              <div className="pt-2 border-t border-border/50 space-y-2">
                {Object.entries(config.personality).map(([key, val]) => (
                  <div key={key}>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {key}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400">
                        {val}/10
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-500"
                        style={{ width: `${(val / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

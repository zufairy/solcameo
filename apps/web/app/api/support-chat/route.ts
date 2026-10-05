import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { GEMINI_KEY, geminiChat } from "@/lib/server/geminiFast";
import { verifyAndFetchPrivyUser, type PrivyAuthUser } from "@/lib/server/privyVerify";

// String ref so this typechecks before `npx convex deploy` regenerates types.
const APPEND = makeFunctionReference<"mutation">("liveChat:append");

export const runtime = "nodejs";
export const maxDuration = 30;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const KIE_CLAUDE_MESSAGES = "https://api.kie.ai/claude/v1/messages";
const KIE_CLAUDE_MODEL = process.env.KIE_CLAUDE_MODEL?.trim() || "claude-haiku-4-5";
// Kie's OpenAI-compat slug for Gemini 3.6 Flash is "gemini-3-6-flash-openai" —
// the bare "gemini-3-6-flash" slug 422s on chat/completions (verified live).
const KIE_GEMINI_MODEL = "gemini-3-6-flash-openai";
const KIE_GEMINI_COMPLETIONS = `https://api.kie.ai/${KIE_GEMINI_MODEL}/v1/chat/completions`;

function kieKey(): string {
  return process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
}

// Vello's support persona — concise, warm, and grounded in what Vello actually is.
const SYSTEM_PROMPT = `You are Vello's assistant on velloagents.com. You help visitors understand and use Vello.

IDENTITY (important): You ARE Vello's assistant. You are NOT Claude, not Anthropic, not ChatGPT, not "an AI language model," and not any other product. Never say, hint, or agree that you are Claude or made by Anthropic. If someone asks what you are or who made you, say you're Vello's assistant, here to help with anything Vello. Never break character.

WHAT VELLO IS:
Vello is the AI influencer network. Anyone can launch an AI influencer (an "agent") that generates short-form videos, auto-posts them to TikTok, YouTube, Instagram, and X, takes on brand campaigns, and earns on Solana.

Key things you can talk about:
- The Builder: where you create an agent. You pick its persona and memory, its niche and voice, its video style, and install apps from the App Store (Auto Hook, Captions, Trending Audio, Video Call To Action, and more). There are two builder modes: AI Influencer (generates original videos) and AI Clipper (turns long videos into short clips and auto-posts them).
- Agents page: a marketplace of live agents. You can hire an agent to generate videos for you (paid on-chain in USDC); the video it makes auto-posts to its connected socials with a caption.
- The Stage / Campaigns (the market): brands post campaigns and pay only for verified views. Agents take those campaigns as bounties and earn per view.
- Payouts and money: agents earn USDC on Solana. Hiring can be per-video or a monthly retainer. Agents also have tradable shares.
- Posting: agents connect TikTok / YouTube / Instagram / X and auto-post on a schedule, with hooks and burned-in captions.

HOW TO ANSWER:
- Sound like a real person: warm, natural, and conversational. Talk to them, not at them.
- Keep it short: usually 1 to 3 sentences. No walls of text, no markdown headers, no bullet dumps unless they ask.
- Answer the actual question first, then a quick nudge if useful (build an agent in the Builder, hire one from the Agents page, or post a campaign on the Stage).
- If you genuinely don't know a specific number (exact pricing) or anything about their personal account, say so honestly and suggest they reach the team. Never invent features or numbers.
- Never use em-dashes (—). Use commas, periods, or the word "to" for ranges instead. Keep punctuation simple and human.`;

type ChatMsg = { role: "user" | "assistant"; content: string };

async function generateReply(history: ChatMsg[], message: string): Promise<string> {
  const key = kieKey();
  if (!key && !GEMINI_KEY) return "Thanks for reaching out! Our team will follow up shortly.";
  // Keep the last ~10 turns for context; append the new visitor message.
  const recent = history.slice(-10).map((m) => ({
    role: m.role,
    content: String(m.content ?? "").slice(0, 2000),
  }));
  const messages = [...recent, { role: "user" as const, content: message.slice(0, 2000) }];
  // Anthropic route first, Gemini second. Kie's claude/v1/messages has gone dark
  // for every claude-* model (HTTP 500 api_error) while gemini-3-6-flash kept
  // answering on the same key — with one provider the site chat just apologised
  // to every visitor for the whole outage.
  const text = (await geminiDirect(messages)) || (key ? await claudeThenGemini(key, messages) : "");
  // Empty here means BOTH routes failed — keep the old honest apology rather than
  // a cheerful prompt that reads like the assistant ignored the question.
  return text || "Sorry, I hit a snag just now. Please try again in a moment.";
}

/** Google-direct Gemini (model chain, quota-aware) — "" when none can answer,
 *  so the Kie chain takes over. */
async function geminiDirect(messages: ChatMsg[]): Promise<string> {
  const r = await geminiChat([{ role: "system", content: SYSTEM_PROMPT }, ...messages], { maxTokens: 400, tag: "support-chat" });
  return r?.text ?? "";
}

/** Kie Gemini 3.6 Flash first (fastest), Kie Claude as fallback. Returns ""
 *  only when BOTH routes fail. */
async function claudeThenGemini(key: string, messages: ChatMsg[]): Promise<string> {
  try {
    const res = await fetch(KIE_GEMINI_COMPLETIONS, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: KIE_GEMINI_MODEL,
        stream: false,
        max_tokens: 400,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    // Kie's "bad request" shape carries `code`/`msg` with no HTTP error status.
    if (data?.code && data.code !== 200) throw new Error(`gemini ${data.code}: ${data.msg ?? "unknown"}`);
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("gemini empty content");
    return text;
  } catch (e) {
    console.warn(`[support-chat] Gemini unavailable (${e instanceof Error ? e.message : e}) — falling back to Claude`);
  }
  try {
    const res = await fetch(KIE_CLAUDE_MESSAGES, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: KIE_CLAUDE_MODEL,
        system: SYSTEM_PROMPT,
        messages,
        stream: false,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`claude HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    const parts = data?.content;
    let text = "";
    if (Array.isArray(parts)) {
      text = parts.map((p: { type?: string; text?: string }) => (p?.type === "text" ? p.text ?? "" : "")).join("");
    }
    text = (text || (typeof data?.message === "string" ? data.message : "")).trim();
    if (!text) throw new Error("claude empty content");
    return text;
  } catch (e) {
    console.error(`[support-chat] Claude fallback failed: ${e instanceof Error ? e.message : e}`);
    return "";
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    message?: string;
    history?: ChatMsg[];
    wallet?: string;
    name?: string;
    page?: string;
  };
  const sessionId = (body.sessionId ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!sessionId || !message) {
    return NextResponse.json({ error: "sessionId and message are required." }, { status: 400 });
  }

  const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
  const now = Date.now();

  // Who is chatting: identity comes ONLY from a verified bearer token, so the
  // admin Live Chat list shows the real account email instead of "Anonymous".
  // Signed-out visitors (or a bad token) stay anonymous — never block the reply.
  let account: PrivyAuthUser | null = null;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) account = await verifyAndFetchPrivyUser(bearer).catch(() => null);

  // 1) Persist the visitor's message (best-effort — never block the reply on it).
  if (convex) {
    await convex
      .mutation(APPEND, {
        sessionId,
        role: "user",
        content: message,
        at: now,
        wallet: account?.walletAddress || body.wallet || undefined,
        name: account?.name || body.name || undefined,
        email: account?.email || undefined,
        userDid: account?.id || undefined,
        page: body.page || undefined,
      })
      .catch(() => {});
  }

  // 2) Generate the AI reply.
  const reply = await generateReply(Array.isArray(body.history) ? body.history : [], message);

  // 3) Persist the AI reply (best-effort).
  if (convex) {
    await convex
      .mutation(APPEND, {
        sessionId,
        role: "assistant",
        content: reply,
        at: Date.now(),
      })
      .catch(() => {});
  }

  return NextResponse.json({ reply });
}

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const KIE_KEY = process.env.KIE_API_KEY ?? "";
const KIE_GEMINI = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";

// Try to pull a YouTube transcript from the public timedtext endpoint.
async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    // Step 1: Get the watch page to find available caption tracks
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!watchRes.ok) return null;
    const html = await watchRes.text();

    // Find ytInitialPlayerResponse → captionTracks
    const match = html.match(/"captionTracks":(\[[^\]]+\])/);
    if (!match) return null;
    const tracks = JSON.parse(match[1]) as Array<{ baseUrl: string; languageCode: string }>;
    const en = tracks.find((t) => t.languageCode === "en") ?? tracks[0];
    if (!en?.baseUrl) return null;

    const captionsRes = await fetch(en.baseUrl);
    if (!captionsRes.ok) return null;
    const xml = await captionsRes.text();
    const lines = Array.from(xml.matchAll(/<text[^>]*>([^<]+)<\/text>/g), (m) =>
      m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
    );
    return lines.join(" ").trim().slice(0, 8000);
  } catch {
    return null;
  }
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Fallback: ask Gemini to "summarize" what the video likely contains based on its URL/title.
// This isn't a real transcript but gives the agent SOMETHING to reason about until a proper
// transcription service (Whisper / AssemblyAI) is wired up.
async function describeViaGemini(url: string): Promise<string | null> {
  if (!KIE_KEY) return null;
  try {
    const res = await fetch(KIE_GEMINI, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-6-flash-openai",
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are a content analyst. Given a video URL, infer what the video is likely about based on the URL structure, slug, and any visible metadata. Output 3-4 sentences covering: probable topic, likely format (vlog/tutorial/short/etc), and tone.",
          },
          { role: "user", content: `Video URL: ${url}\n\nProvide a content inference for an AI agent's style reference library.` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // AUTH GATE — this route spends KIE credits (Gemini inference) on every call.
    // Require an internal secret or a logged-in user; without this, anonymous
    // callers could burn paid LLM credits at will.
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    const { sessionId, videoUrl, personaName } = (await req.json()) as {
      sessionId?: string;
      videoUrl?: string;
      personaName?: string;
    };

    if (!sessionId || !videoUrl) {
      return NextResponse.json({ error: "sessionId and videoUrl required" }, { status: 400 });
    }

    let transcript: string | null = null;
    let source: "youtube_captions" | "gemini_inference" | "none" = "none";

    const ytId = extractYouTubeId(videoUrl);
    if (ytId) {
      transcript = await fetchYouTubeTranscript(ytId);
      if (transcript) source = "youtube_captions";
    }

    if (!transcript) {
      transcript = await describeViaGemini(videoUrl);
      if (transcript) source = "gemini_inference";
    }

    if (!transcript) {
      return NextResponse.json({ ok: false, error: "Could not fetch transcript or inference for this video" }, { status: 500 });
    }

    // Update the knowledge entry with the transcript
    if (CONVEX_URL) {
      try {
        const client = new ConvexHttpClient(CONVEX_URL);
        const name = personaName ?? "Agent";
        const host = new URL(videoUrl).hostname.replace("www.", "");
        await client.mutation(api.agentKnowledge.saveEntry, {
          sessionId,
          title: `${name} — Transcript: ${host}`,
          content: [
            `# Video Transcript`,
            ``,
            `**URL:** ${videoUrl}`,
            `**Source:** ${source === "youtube_captions" ? "YouTube auto-captions" : "AI content inference (Gemini)"}`,
            `**Saved:** ${new Date().toISOString()}`,
            ``,
            `## Transcript`,
            transcript,
            ``,
            `---`,
            `*This transcript is part of ${name}'s knowledge base. The agent uses it to study tone, hook structure, pacing, and content format.*`,
          ].join("\n"),
          tags: ["video-transcript", "knowledge-study", source],
          category: "knowledge",
          links: [],
          entryType: "auto_memory",
          localId: `transcript-${sessionId}-${videoUrl.slice(-24)}`,
        });
      } catch (err) {
        console.error("[transcribe-video] convex save failed:", err);
      }
    }

    return NextResponse.json({ ok: true, source, length: transcript.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import type { CampaignBlueprint } from "@/lib/builder/campaignBlueprint";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

function normalizeText(v: unknown, max = 400) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function triggerHighgsfield(params: {
  campaignName: string;
  prompt: string;
  imageUrl?: string;
}) {
  const apiKey = process.env.HIGGSFIELD_API_KEY?.trim();
  if (!apiKey) {
    return `Higgsfield not configured (add HIGGSFIELD_API_KEY). Prompt ready: "${params.prompt}"`;
  }

  try {
    const res = await fetch("https://api.higgsfield.ai/v1/generate/image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        model: "veo3",
        aspect_ratio: "9:16",
      }),
    });

    if (!res.ok) {
      return `Higgsfield returned ${res.status}. Prompt was: "${params.prompt}"`;
    }

    const data = (await res.json()) as { url?: string; id?: string };
    if (data.url) return `Generated: ${data.url}`;
    if (data.id) return `Job queued (id: ${data.id}). Check Higgsfield dashboard.`;
    return `Request accepted. No URL returned yet.`;
  } catch (err) {
    return `Higgsfield error: ${err instanceof Error ? err.message : "Unknown"}`;
  }
}

async function triggerGmail(params: {
  campaignName: string;
  productName: string;
  communityName: string;
  angle: string;
}) {
  const subject = `Creator opportunity: ${params.campaignName || params.communityName}`;
  const body = `Hi [Creator Name],

I'm building a creator campaign called "${params.campaignName}" for ${params.communityName}.

Campaign angle: ${params.angle || "Looking for authentic short-form content"}

If you're interested in joining, you'll earn per 1k views on approved posts.

Reply here or join the campaign directly on Vello.

— ${params.communityName} Team`;

  return `Draft ready:\n\nSubject: ${subject}\n\n${body}`;
}

async function triggerClickUp(params: {
  campaignName: string;
  communityName: string;
}) {
  const apiKey = process.env.CLICKUP_API_KEY?.trim();
  if (!apiKey) {
    return `ClickUp not configured (add CLICKUP_API_KEY). Task: "Launch ${params.campaignName}"`;
  }

  const listId = process.env.CLICKUP_DEFAULT_LIST_ID?.trim();
  if (!listId) {
    return `CLICKUP_DEFAULT_LIST_ID missing. Task ready: "Launch ${params.campaignName}"`;
  }

  try {
    const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        name: `Launch ${params.campaignName}`,
        description: `Campaign for ${params.communityName}. Created via Vello builder.`,
        status: "Open",
      }),
    });

    if (!res.ok) return `ClickUp returned ${res.status}`;
    const data = (await res.json()) as { id?: string; url?: string };
    return data.url
      ? `Task created: ${data.url}`
      : `Task created (id: ${data.id})`;
  } catch (err) {
    return `ClickUp error: ${err instanceof Error ? err.message : "Unknown"}`;
  }
}

export async function POST(request: NextRequest) {
  try {
    // AUTH GATE — the "trigger" action spends real money (Higgsfield image
    // generation) and mutates external state (ClickUp task creation) using the
    // server's secret API keys; unauthenticated, an attacker could loop it to
    // drain credits / spam tasks. Require an internal secret or a logged-in user,
    // matching the sibling paid builder route app/api/builder/generate-avatar.
    // Browser callers already carry the Privy bearer via the global /api/ fetch
    // interceptor (providers/supabase-auth-provider), so no client change is needed.
    const auth = await requireInternalOrUserAuth(request);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      toolId?: string;
      campaignBlueprint?: CampaignBlueprint;
      prompt?: string;
    };

    const { action, toolId, campaignBlueprint = {}, prompt = "" } = body;

    if (action === "connect") {
      // In a production app, this would initiate OAuth or store API keys.
      // For now we return success to allow the UI to mark it connected.
      return NextResponse.json({ connected: true, toolId });
    }

    if (action !== "trigger") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const campaignName = normalizeText(campaignBlueprint.campaign?.name, 200) || "Campaign";
    const communityName = normalizeText(campaignBlueprint.community?.name, 200) || "Community";
    const productName = normalizeText(campaignBlueprint.product?.name, 200) || "Product";
    const angle = normalizeText(campaignBlueprint.campaign?.angle || campaignBlueprint.product?.headline, 400);
    const imageUrl = normalizeText(campaignBlueprint.campaign?.imageUrl || campaignBlueprint.community?.imageUrl, 500);
    const effectivePrompt = prompt || angle || `Marketing video for ${campaignName} — ${communityName}`;

    let result: string;

    switch (toolId) {
      case "higgsfield":
        result = await triggerHighgsfield({ campaignName, prompt: effectivePrompt, imageUrl });
        break;
      case "gmail":
        result = await triggerGmail({ campaignName, productName, communityName, angle });
        break;
      case "clickup":
        result = await triggerClickUp({ campaignName, communityName });
        break;
      default:
        return NextResponse.json({ error: `Unknown tool: ${toolId}` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

import { safeParseCampaignBlueprint } from "@/lib/builder/campaignBlueprint";
import { fetchWebsiteIntelligence } from "@/lib/builder/websiteIntelligence";
 
import { api as _api } from "@/convex/_generated/api";
// builder module is generated after `npx convex dev` — cast until then
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeText(value: unknown, maxChars = 4000) {
  return typeof value === "string"
    ? value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars)
    : "";
}

function clampBudget(value: number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(15, Math.max(5, Math.round(value)));
  }
  return 10;
}

function pickFallbackImage(seed: string) {
  const lower = seed.toLowerCase();
  if (/\b(web3|crypto|solana|wallet|defi|dao|token)\b/.test(lower)) {
    return "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?q=80&w=1600&auto=format&fit=crop";
  }
  if (/\b(ai|saas|software|app|tool|automation|tech)\b/.test(lower)) {
    return "https://images.unsplash.com/photo-1498050108023-c5249f4df085?q=80&w=1600&auto=format&fit=crop";
  }
  if (/\b(fitness|health|wellness|coach|training)\b/.test(lower)) {
    return "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=1600&auto=format&fit=crop";
  }
  if (/\b(education|course|community|academy|creator|content|media)\b/.test(lower)) {
    return "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1600&auto=format&fit=crop";
  }
  return "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1600&auto=format&fit=crop";
}

export async function POST(request: NextRequest) {
  try {
    // AUTH GATE: this route creates owner-scoped workspace/product/campaign rows.
    // It previously trusted body.userId for ownership — spoofable. We now derive
    // the owner from the AUTHED identity: an internal caller (cron secret) may set
    // the owner from the body; a user caller must present a valid SIWS session and
    // the owner is the on-chain-PROVEN wallet, never a client-supplied field.
    const auth = await requireInternalOrUserAuth(request);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let ownerWallet: string;
    if (auth.internal) {
      // Server-to-server: trust the body's userId (already a trusted caller).
      ownerWallet = typeof body.userId === "string" ? body.userId.trim() : "";
      if (!ownerWallet) {
        return NextResponse.json({ error: "userId (wallet address) is required" }, { status: 400 });
      }
    } else {
      // User caller: require a SIWS session and use the proven wallet as the owner.
      const siwsErr = requireSiwsSession(auth);
      if (siwsErr) return siwsErr;
      ownerWallet = auth.provenWallet ?? "";
      if (!ownerWallet) {
        return NextResponse.json({ error: "Wallet sign-in required", code: "siws_required" }, { status: 401 });
      }
    }
    // From here, `ownerWallet` is the authenticated owner — never body.userId.
    const userId = ownerWallet;

    const rawBlueprint =
      body.campaignBlueprint && typeof body.campaignBlueprint === "object"
        ? body.campaignBlueprint
        : {};

    const blueprint = safeParseCampaignBlueprint(rawBlueprint) ?? {};

    const communityName =
      normalizeText(blueprint.community?.name, 200) ||
      normalizeText(blueprint.product?.name, 200) ||
      "My Community";

    const communityDescription = normalizeText(blueprint.community?.description, 1000);
    const productName = normalizeText(blueprint.product?.name, 200) || communityName;
    const productHeadline = normalizeText(blueprint.product?.headline, 400);
    const productDescription = normalizeText(blueprint.product?.description, 1000);
    const campaignName =
      normalizeText(blueprint.campaign?.name, 200) || `${communityName} Campaign`;
    const campaignAngle = normalizeText(blueprint.campaign?.angle, 400);
    const sourceUrl = "";
    const knowledgeBaseText = normalizeText(body.knowledgeBaseText, 4000);
    const communityImageUrl = normalizeText(body.communityImageUrl, 500);
    const campaignImageUrl = normalizeText(body.campaignImageUrl, 500);
    const budgetUsdc = clampBudget(blueprint.funding?.exampleTreasuryCreditUsd);
    const ratePerThousandViews = 1.5;

    // Resolve images
    let website: Awaited<ReturnType<typeof fetchWebsiteIntelligence>> = null;
    if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      try {
        website = await fetchWebsiteIntelligence(sourceUrl);
      } catch {
        website = null;
      }
    }

    const seed = [productName, campaignName, knowledgeBaseText.slice(0, 240), website?.title, website?.description]
      .filter(Boolean)
      .join(" ");
    const fallbackImage = pickFallbackImage(seed);

    const websiteCoverImage = normalizeText(website?.heroImage, 500);
    const websiteProfileImage = normalizeText(website?.logoImage, 500);
    const websiteImage = websiteCoverImage || websiteProfileImage;

    const coverImage =
      communityImageUrl ||
      campaignImageUrl ||
      websiteImage ||
      fallbackImage;

    const profileImage =
      websiteProfileImage ||
      websiteImage ||
      coverImage ||
      fallbackImage;

    const resolvedCampaignImage =
      campaignImageUrl || websiteCoverImage || coverImage || fallbackImage;

    const slug = slugify(communityName) || `workspace-${Date.now()}`;

    const convex = getConvexClient();

    // Create workspace
    const { id: workspaceId, slug: finalSlug } = await convex.mutation(
      api.builder.createWorkspace,
      {
        ownerWallet: userId,
        name: communityName,
        slug,
        description: communityDescription || undefined,
        coverImageUrl: coverImage || undefined,
        profileImageUrl: profileImage || undefined,
        sourceUrl: sourceUrl || undefined,
        audience: normalizeText(blueprint.community?.audience, 400) || undefined,
        knowledgeBaseText: knowledgeBaseText || undefined,
        tags: Array.isArray(blueprint.community?.keyFeatures)
          ? blueprint.community.keyFeatures.slice(0, 10)
          : undefined,
      },
    );

    // Create product
    const { id: productId } = await convex.mutation(api.builder.createProduct, {
      workspaceId,
      ownerWallet: userId,
      name: productName,
      headline: productHeadline || undefined,
      description: productDescription || communityDescription || undefined,
      imageUrl: coverImage || undefined,
      sourceUrl: sourceUrl || undefined,
      deliverables: Array.isArray(blueprint.product?.features)
        ? blueprint.product.features.slice(0, 8)
        : undefined,
    });

    // Create campaign
    const { id: campaignId } = await convex.mutation(api.builder.createCampaign, {
      workspaceId,
      productId,
      ownerWallet: userId,
      name: campaignName,
      angle: campaignAngle || undefined,
      campaignType: "ugc",
      imageUrl: resolvedCampaignImage || undefined,
      budgetUsdc,
      ratePerThousandViews,
    });

    return NextResponse.json({
      community: { id: workspaceId, slug: finalSlug, name: communityName },
      product: { id: productId, name: productName },
      campaign: { id: campaignId, name: campaignName },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("[builder/community-setup]", detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

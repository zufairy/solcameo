import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** Fired once, right after a brand-new user's first-ever `upsertFromSupabase`
 *  insert (see users.ts) — never on returning-user sign-ins. No-ops quietly
 *  if RESEND_API_KEY isn't configured yet, so local/dev deploys without an
 *  email provider set up don't fail signup. */
export const sendWelcomeEmail = internalAction({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (_ctx, { email, name }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[email] RESEND_API_KEY not set — skipping welcome email to", email);
      return;
    }
    const from = process.env.RESEND_FROM_EMAIL || "Vello <welcome@vello.gg>";
    const firstName = (name?.trim().split(/\s+/)[0] || email.split("@")[0]).slice(0, 40);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: `${firstName}, your content team just clocked in 🎬`,
        html: welcomeEmailHtml(firstName),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[email] Resend send failed:", res.status, body.slice(0, 500));
    }
  },
});

const APP_URL = "https://vello.gg";

const FEATURES: { emoji: string; title: string; blurb: string; href: string }[] = [
  { emoji: "✂️", title: "AI Clipping", blurb: "Feed it a long video, it hunts down the 5 moments people will actually stop scrolling for.", href: `${APP_URL}/studio/build?tab=clipping` },
  { emoji: "🧑‍🚀", title: "AI Influencer", blurb: "A consistent virtual face that stars in your content — no camera, no crew, no bad hair days.", href: `${APP_URL}/studio/build?tab=influencer` },
  { emoji: "🖼️", title: "Photo Carousel", blurb: "Turn one idea into a scroll-stopping multi-image carousel, styled and captioned automatically.", href: `${APP_URL}/carousel` },
  { emoji: "🔁", title: "Recreate", blurb: "Found an ad you love? Drop the link — Vello rebuilds it around your own product.", href: `${APP_URL}/recreate` },
  { emoji: "🎥", title: "Documentary", blurb: "Turn any idea or product into a narrated mini-documentary — real footage, real voiceover, zero film crew.", href: `${APP_URL}/documentary` },
  { emoji: "🐝", title: "Content Swarm", blurb: "A whole squad of AI agents pumping out content variations at once, so you pick winners instead of guessing.", href: `${APP_URL}/swarm` },
  { emoji: "📣", title: "Campaigns", blurb: "Launch a campaign, pay real creators for real results — all tracked, all onchain.", href: `${APP_URL}/stage/create` },
];

function featureRow(f: { emoji: string; title: string; blurb: string; href: string }): string {
  return `
  <tr>
    <td style="padding:14px 0;border-bottom:1px solid #232326;">
      <a href="${f.href}" style="text-decoration:none;color:inherit;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="40" style="font-size:22px;vertical-align:top;padding-right:10px;">${f.emoji}</td>
            <td style="vertical-align:top;">
              <div style="font-size:15px;font-weight:600;color:#ffffff;">${f.title}</div>
              <div style="font-size:13.5px;line-height:1.5;color:#a1a1aa;margin-top:2px;">${f.blurb}</div>
            </td>
          </tr>
        </table>
      </a>
    </td>
  </tr>`;
}

function welcomeEmailHtml(firstName: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#08080a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08080a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0f0f12;border:1px solid #1f1f23;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:36px 32px 8px;text-align:center;">
              <div style="font-size:28px;">🎬</div>
              <h1 style="margin:14px 0 0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Hey ${firstName}, welcome to Vello!</h1>
              <p style="margin:10px 0 0;font-size:14.5px;line-height:1.6;color:#a1a1aa;">
                You just signed up for the closest thing to hiring a full content team — except it's instant, it's yours, and it never sleeps.
                Here's everything you can throw at it starting right now:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${FEATURES.map(featureRow).join("")}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;text-align:center;">
              <a href="${APP_URL}/home" style="display:inline-block;background:#ffffff;color:#0f0f12;font-weight:600;font-size:14px;padding:12px 26px;border-radius:10px;text-decoration:none;">
                Make your first video →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 36px;text-align:center;">
              <p style="margin:0;font-size:12.5px;color:#5c5c62;">
                No fluff, we promise — just pick a card above and go. See you in there.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-size:11.5px;color:#3f3f46;">Vello · ${APP_URL}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

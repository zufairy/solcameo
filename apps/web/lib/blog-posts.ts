export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "list"; items: string[] }
  | { type: "links"; items: { label: string; href: string }[] };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO
  readMinutes: number;
  content: BlogBlock[];
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-run-a-paid-clipping-campaign",
    title: "How to Run a Paid Clipping Campaign, Step by Step",
    description:
      "A practical walkthrough of setting up a clip-to-earn campaign: budget, source content, clipper payouts, and view verification.",
    date: "2026-08-10",
    readMinutes: 6,
    content: [
      {
        type: "p",
        text: "A clipping campaign pays other creators to cut your long-form content into short clips and post them to their own audiences. Done right, it turns a single podcast episode or stream into hundreds of clips across TikTok, Reels, and Shorts — without you editing or posting a single one yourself.",
      },
      { type: "h2", text: "1. Pick source content worth clipping" },
      {
        type: "p",
        text: "Clippers need raw material with moments in it — a strong hook, a funny beat, a hot take. Podcasts, livestreams, and talks work best. A single 45-90 minute source usually yields 10-30 usable clips.",
      },
      { type: "h2", text: "2. Set a budget and a payout rate" },
      {
        type: "p",
        text: "Decide what you're willing to pay per 1,000 verified views (a common range is $0.50-$4 per 1K depending on niche and platform). Fund the campaign upfront — on Vello this goes into an on-chain escrow, so clippers can see the budget is real before they start posting.",
      },
      { type: "h2", text: "3. Publish the campaign brief" },
      {
        type: "list",
        items: [
          "What the source content is and where to pull it from",
          "Do's and don'ts (branding, captions, banned edits)",
          "Payout rate per verified 1,000 views",
          "Which platforms count (TikTok, IG Reels, YouTube Shorts, X)",
        ],
      },
      { type: "h2", text: "4. Let clippers post and track views" },
      {
        type: "p",
        text: "Clippers submit their posted links. Views get pulled from each platform's own analytics, not self-reported numbers — this is the step most manual campaigns skip, and it's why manual clip-to-earn runs on trust and spreadsheets instead of verified data.",
      },
      { type: "h2", text: "5. Pay out automatically" },
      {
        type: "p",
        text: "Once views are verified, payouts release from escrow automatically. No invoices, no chasing people down for a wallet address, no manual view-count screenshots. This is the part that breaks down fastest when campaigns are run manually over Discord and spreadsheets — automating it is the difference between a campaign that scales to 50 clippers and one that stalls at 5.",
      },
      {
        type: "p",
        text: "If you want this whole flow — budget, brief, submissions, verified payouts — running without building it yourself, that's what Vello's builder sets up in a few minutes.",
      },
    ],
  },
  {
    slug: "ai-clipping-vs-manual-editing-cost",
    title: "Automated Clipping vs Manual Editing: What It Actually Costs",
    description:
      "A cost breakdown of hiring an editor, using a solo AI clip tool, and running a paid clipping campaign, and when each makes sense.",
    date: "2026-08-05",
    readMinutes: 5,
    content: [
      {
        type: "p",
        text: "There are three ways to turn long-form content into short clips: hire an editor, use a solo AI clipping tool, or fund a paid clipping campaign. Each has a very different cost curve.",
      },
      { type: "h2", text: "Hiring an editor" },
      {
        type: "p",
        text: "A freelance video editor typically charges $15-40 per clip, or $500-2,000/month for a steady stream. Quality is high and consistent, but it doesn't scale with your content volume — double your source content and you double the bill.",
      },
      { type: "h2", text: "Solo AI clipping tools" },
      {
        type: "p",
        text: "Tools like OpusClip, Klap, Munch, and Vizard charge $20-100/month for AI-assisted clipping, and you still post everything yourself. Cheap per clip, but distribution is capped at your own audience — the clips are only as good as your own reach.",
      },
      { type: "h2", text: "Paid clipping campaigns" },
      {
        type: "p",
        text: "You set a budget and pay per verified view instead of per clip or per month. There's no fixed monthly cost — if nobody watches, you don't pay much; if a clip blows up, you pay more but you got the views. This is the only model where cost scales directly with the outcome you actually wanted (views), not with editing effort.",
      },
      { type: "h2", text: "Which one to pick" },
      {
        type: "list",
        items: [
          "Small, steady content volume, own audience is enough: solo AI tool",
          "High production value, brand-sensitive content: hire an editor",
          "Want reach beyond your own account, want to pay for results not effort: paid clipping campaign",
        ],
      },
      {
        type: "p",
        text: "Vello runs the AI clipping and the paid campaign in one place — the AI does the first cut, clippers polish and post, and you pay per verified view from a locked budget.",
      },
    ],
  },
  {
    slug: "best-opusclip-alternatives-2026",
    title: "Best OpusClip Alternatives in 2026",
    description:
      "What to look for in an OpusClip alternative, and where Vello, Klap, Munch, and Vizard differ.",
    date: "2026-07-28",
    readMinutes: 5,
    content: [
      {
        type: "p",
        text: "OpusClip popularized AI-assisted clipping — feed it a long video, get short clips with captions and hooks back. A handful of alternatives have since specialized in different directions. Here's how to think about which one fits.",
      },
      { type: "h2", text: "If you just need faster editing" },
      {
        type: "p",
        text: "Klap and Vizard are close OpusClip substitutes — solid AI reframing, captions, and virality scoring, priced similarly. Pick whichever UI you prefer; the output quality is comparable across all three.",
      },
      { type: "h2", text: "If you need scheduling built in" },
      {
        type: "p",
        text: "Munch leans harder into repurposing-plus-scheduling, so if your bottleneck is posting cadence rather than editing speed, it's worth a look.",
      },
      { type: "h2", text: "If distribution is the actual bottleneck" },
      {
        type: "p",
        text: "None of the above solve the problem of only reaching your own audience. If you have content worth clipping but not enough reach to make it go far, the fix isn't a better editor — it's more people posting it. That's the gap Vello fills: AI clipping plus a paid campaign layer, so other creators post your clips to their own audiences and get paid per verified view from an on-chain escrow.",
      },
      {
        type: "links",
        items: [
          { label: "Vello vs OpusClip", href: "/vs/opusclip" },
          { label: "Vello vs Klap", href: "/vs/klap" },
          { label: "Vello vs Munch", href: "/vs/munch" },
          { label: "Vello vs Vizard", href: "/vs/vizard" },
        ],
      },
      { type: "h2", text: "Bottom line" },
      {
        type: "p",
        text: "Editing-only tools (OpusClip, Klap, Vizard, Munch) are interchangeable on core AI clipping quality. The real fork in the road is whether you need distribution beyond your own account — that's what a paid clipping campaign gets you that a solo editor can't.",
      },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

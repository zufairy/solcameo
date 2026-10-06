/* ════════ Solcameo Docs: chapter map (single source of truth) ════════
   Every docs route, its nav segment, sidebar group, and the section anchors
   that drive scroll-spy + the progress rail all live here. The shell reads
   this; the page files only supply prose. Keep section ids in sync with the
   <Section id> anchors rendered on each page. */

export type DocSection = { id: string; label: string };

export type DocChapter = {
  /** Route path. The overview lives at /docs (slug ""). */
  slug: string;
  /** Top-nav segment label. */
  nav: string;
  /** Roman numeral shown in the sidebar (overview has none). */
  numeral?: string;
  /** Sidebar group title. */
  title: string;
  /** Eyebrow pill above the page heading. */
  eyebrow: string;
  /** Anchored sections, in reading order. */
  sections: DocSection[];
};

export const DOCS_BASE = "/docs";

export const CHAPTERS: DocChapter[] = [
  {
    slug: "",
    nav: "Overview",
    title: "Launch an AI character with its own coin",
    eyebrow: "Overview",
    sections: [
      { id: "welcome", label: "Introduction" },
      { id: "what-is-solcameo", label: "What is Solcameo?" },
      { id: "the-journey", label: "The four stages" },
      { id: "prerequisites", label: "Before you start" },
      { id: "using-these-docs", label: "Using these docs" },
    ],
  },
  {
    slug: "start",
    nav: "Start",
    numeral: "I",
    title: "Getting started",
    eyebrow: "Chapter I",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "sign-in", label: "Sign in" },
      { id: "wallet", label: "Your wallet" },
      { id: "deposit", label: "Add SOL" },
      { id: "explore-first", label: "Look around first" },
    ],
  },
  {
    slug: "build",
    nav: "Create",
    numeral: "II",
    title: "Create your influencer",
    eyebrow: "Chapter II",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "open-builder", label: "Open the builder" },
      { id: "character", label: "Design the character" },
      { id: "generate", label: "Generate and save" },
      { id: "video-ideas", label: "Top video ideas" },
      { id: "replicate", label: "Replicate a motion" },
      { id: "identity", label: "One identity everywhere" },
    ],
  },
  {
    slug: "launch",
    nav: "Launch",
    numeral: "III",
    title: "Launch its coin",
    eyebrow: "Chapter III",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "coin-details", label: "Name and ticker" },
      { id: "approve", label: "Approve the launch" },
      { id: "the-curve", label: "The bonding curve" },
      { id: "graduation", label: "Graduation" },
      { id: "fees", label: "Where fees go" },
      { id: "devnet-risk", label: "Devnet and risk" },
    ],
  },
  {
    slug: "grow",
    nav: "Grow",
    numeral: "IV",
    title: "Community, callouts and growth",
    eyebrow: "Chapter IV",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "market-page", label: "The market page" },
      { id: "community-chat", label: "Community chat" },
      { id: "chapters", label: "Fans steer the plot" },
      { id: "callouts", label: "Callouts" },
      { id: "leaderboard", label: "The leaderboard" },
      { id: "analytics", label: "Analytics and sharing" },
    ],
  },
];

export const OVERVIEW = CHAPTERS[0];
/** Chapters that get a numbered sidebar group (everything but the overview). */
export const NUMBERED = CHAPTERS.filter((c) => c.numeral);

export function chapterBySlug(slug: string): DocChapter | undefined {
  return CHAPTERS.find((c) => c.slug === slug);
}

export function hrefForChapter(slug: string): string {
  return slug ? `${DOCS_BASE}/${slug}` : DOCS_BASE;
}

/* ════════ Vello Docs — chapter map (single source of truth) ════════
   Every docs route, its nav segment, sidebar group, and the section anchors
   that drive scroll-spy + the progress rail all live here. The shell reads
   this; the page files only supply prose. Keep section ids in sync with the
   <Section id> anchors rendered on each page. */

export type DocSection = { id: string; label: string };

export type DocChapter = {
  /** Route path. The overview lives at /docs (slug ""). */
  slug: string;
  /** Top-nav segment label — matches the /landing nav exactly. */
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
    nav: "How to",
    title: "How to launch & earn with Vello",
    eyebrow: "Overview",
    sections: [
      { id: "welcome", label: "Introduction" },
      { id: "what-is-vello", label: "What is Vello?" },
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
      { id: "create-account", label: "Create your account" },
      { id: "connect-wallet", label: "Connect a wallet" },
      { id: "fund-agent", label: "Fund your agent" },
      { id: "first-influencer", label: "Launch your first influencer" },
      { id: "dashboard", label: "Your dashboard" },
    ],
  },
  {
    slug: "build",
    nav: "Build",
    numeral: "II",
    title: "Build a Vello agent",
    eyebrow: "Chapter II",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "open-builder", label: "Open the builder" },
      { id: "persona", label: "Persona & niche" },
      { id: "face-voice", label: "Face & voice" },
      { id: "mint", label: "Mint the identity" },
      { id: "memory", label: "Knowledge & memory" },
      { id: "content-style", label: "Content style" },
      { id: "skills", label: "Add skills" },
      { id: "templates", label: "Skill templates" },
      { id: "schedule", label: "Publishing schedule" },
    ],
  },
  {
    slug: "sell",
    nav: "Sell",
    numeral: "III",
    title: "Campaigns & posting",
    eyebrow: "Chapter III",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "daily-posting", label: "Daily posting" },
      { id: "browse-campaigns", label: "Browse campaigns" },
      { id: "eligibility", label: "Campaign eligibility" },
      { id: "submissions", label: "Submissions" },
      { id: "approvals", label: "Approvals & review" },
      { id: "captions", label: "Smart captions" },
    ],
  },
  {
    slug: "scale",
    nav: "Scale",
    numeral: "IV",
    title: "Earn & scale",
    eyebrow: "Chapter IV",
    sections: [
      { id: "intro", label: "Introduction" },
      { id: "how-earning-works", label: "How earning works" },
      { id: "usdc-payouts", label: "USDC payouts" },
      { id: "treasury", label: "Vaults & treasury" },
      { id: "analytics", label: "Performance analytics" },
      { id: "multiple-agents", label: "Run multiple agents" },
      { id: "agency", label: "Make money as an agency" },
      { id: "whats-next", label: "What comes next" },
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

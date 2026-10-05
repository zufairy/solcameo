/** Content for /dev/team-schedule — the 4-staff, 4-week posting program.
 *  Static curriculum (code, not DB); only the daily checkmarks are stored
 *  (convex/devTeamSchedule.ts). Posting targets: 2 clipping accounts × 3–4
 *  posts/day + 2 AI-influencer accounts × 3 posts/day, per staff member. */

export const STAFF = [
  { id: "suhaimi", name: "Suhaimi" },
  { id: "will", name: "Will" },
  { id: "fatin", name: "Fatin" },
  { id: "aisyah", name: "Aisyah" },
] as const;

export type StaffId = (typeof STAFF)[number]["id"];

export interface WeekPlan {
  title: string;
  blurb: string;
  steps: string[];
}

export const WEEKS: WeekPlan[] = [
  {
    title: "Week 1 — Setup & Warm-up",
    blurb: "Stand up all 4 accounts (2 clipping + 2 AI influencer) and post lightly to warm each one up before scaling to full volume.",
    steps: [
      "Clipping account 1 — created & platform-connected",
      "Clipping account 2 — created & platform-connected",
      "AI influencer account 1 — created & platform-connected",
      "AI influencer account 2 — created & platform-connected",
      "Post once on each clipping account (warm-up volume)",
      "Post once on each influencer account (warm-up volume)",
      "Log today's video-generation cost estimate",
    ],
  },
  {
    title: "Week 2 — Engage & Scale",
    blurb: "Ramp up to full daily posting volume and start actively engaging the audience that's building.",
    steps: [
      "Clipping account 1 — post 3–4×",
      "Clipping account 2 — post 3–4×",
      "AI influencer account 1 — post 3×",
      "AI influencer account 2 — post 3×",
      "Reply to comments / DMs on all 4 accounts",
      "Flag today's best-performing post",
    ],
  },
  {
    title: "Week 3 — Reporting",
    blurb: "Keep posting at full volume, track numbers daily, and roll them into a weekly report.",
    steps: [
      "Clipping account 1 — post 3–4×",
      "Clipping account 2 — post 3–4×",
      "AI influencer account 1 — post 3×",
      "AI influencer account 2 — post 3×",
      "Log today's views / engagement per account",
      "Submit weekly report (due Friday)",
    ],
  },
  {
    title: "Week 4 — Fix & Analyze",
    blurb: "Use 3 weeks of data to find what's underperforming and fix it.",
    steps: [
      "Clipping account 1 — post 3–4×",
      "Clipping account 2 — post 3–4×",
      "AI influencer account 1 — post 3×",
      "AI influencer account 2 — post 3×",
      "Review analytics dashboard for all 4 accounts",
      "Apply 1 concrete fix (caption / hook / timing / thumbnail)",
    ],
  },
];

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

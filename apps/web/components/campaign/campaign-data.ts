/** Static option sets and small helpers for the campaign form. */

export const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },
  { code: "SG", name: "Singapore" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "IN", name: "India" },
  { code: "PH", name: "Philippines" },
  { code: "AE", name: "UAE" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "TR", name: "Turkey" },
  { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "VN", name: "Vietnam" },
  { code: "TH", name: "Thailand" },
  { code: "PK", name: "Pakistan" },
];

export const AGE_GROUPS = ["18-24", "25-34", "35-44", "45+"] as const;
export const GENDERS = [
  { id: "all", label: "Everyone" },
  { id: "women", label: "Women" },
  { id: "men", label: "Men" },
] as const;
export type GenderId = (typeof GENDERS)[number]["id"];

export interface Demographics { countries: string[]; ages: string[]; gender: GenderId }

/** One human-readable requirement line agents obey, or null when nothing narrows the audience.
 *  (Stored as a requirement so it works without a backend schema change.) */
export function audienceRequirement(d: Demographics): string | null {
  const parts: string[] = [];
  const names = d.countries.map((c) => COUNTRIES.find((x) => x.code === c)?.name).filter(Boolean) as string[];
  if (names.length) parts.push(`audience in ${names.join(", ")}`);
  if (d.ages.length) parts.push(`ages ${d.ages.join(", ")}`);
  if (d.gender !== "all") parts.push(`mainly ${d.gender}`);
  return parts.length ? `Target audience: ${parts.join("; ")}. Create and post content for this audience.` : null;
}

/** Quick-add requirement ideas, shown even before (or without) the AI writer. */
export function requirementIdeas(type: string, board: string, brand: string): string[] {
  const b = brand.trim() || "the brand";
  if (type === "bounty") return [
    "Submit a public link as proof of completion",
    "Include a screenshot showing the result",
    "Original work only, no reposted content",
    `Mention ${b} clearly in the submission`,
  ];
  if (type === "agent_task") return [
    "Return a short written summary of what was done",
    "Include source links for every claim",
    "Stay within the task scope; no extra actions",
    "Flag anything uncertain instead of guessing",
  ];
  if (board === "clipping") return [
    "Open on the most quotable moment in the first 2 seconds",
    "Add on-screen captions to every clip",
    "Keep each clip between 15 and 45 seconds",
    "Credit the original creator in the caption",
    `Tag ${b} in the post`,
  ];
  return [
    `Mention ${b} by name in the first 3 seconds`,
    "Show the product in use, not just talk about it",
    "Add on-screen captions",
    "Keep videos between 15 and 45 seconds",
    "End with a clear call to action",
    "No competitor brands or unverified claims",
  ];
}

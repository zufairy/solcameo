/** Countries the Agent Launch card can draw a pixel flag for (ISO 3166-1 alpha-2). */
export const COUNTRIES: { code: string; name: string }[] = [
  ["US", "United States"], ["GB", "United Kingdom"], ["MY", "Malaysia"], ["SG", "Singapore"], ["ID", "Indonesia"], ["IN", "India"], ["PH", "Philippines"], ["TH", "Thailand"], ["VN", "Vietnam"],
  ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"], ["HK", "Hong Kong"], ["TW", "Taiwan"], ["AU", "Australia"], ["NZ", "New Zealand"], ["CA", "Canada"], ["DE", "Germany"], ["FR", "France"],
  ["ES", "Spain"], ["IT", "Italy"], ["PT", "Portugal"], ["NL", "Netherlands"], ["SE", "Sweden"], ["IE", "Ireland"], ["PL", "Poland"], ["UA", "Ukraine"], ["RU", "Russia"], ["TR", "Turkey"],
  ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["EG", "Egypt"], ["NG", "Nigeria"], ["ZA", "South Africa"], ["PK", "Pakistan"], ["BD", "Bangladesh"], ["BR", "Brazil"], ["MX", "Mexico"], ["AR", "Argentina"], ["CO", "Colombia"],
].map(([code, name]) => ({ code, name }));

const BY_LANGUAGE: Record<string, string> = {
  en: "US", english: "US", ms: "MY", malay: "MY", id: "ID", indonesian: "ID", hi: "IN", hindi: "IN", tl: "PH", fil: "PH", filipino: "PH", tagalog: "PH", th: "TH", thai: "TH", vi: "VN", vietnamese: "VN",
  ja: "JP", japanese: "JP", ko: "KR", korean: "KR", zh: "CN", chinese: "CN", mandarin: "CN", es: "ES", spanish: "ES", pt: "BR", portuguese: "BR", fr: "FR", french: "FR", de: "DE", german: "DE",
  it: "IT", italian: "IT", nl: "NL", dutch: "NL", sv: "SE", swedish: "SE", pl: "PL", polish: "PL", uk: "UA", ukrainian: "UA", ru: "RU", russian: "RU", tr: "TR", turkish: "TR", ar: "AE", arabic: "AE",
  ur: "PK", urdu: "PK", bn: "BD", bengali: "BD",
};

/** Best-guess country for an agent from its language ("en-GB" keeps its region). Empty when unknown. */
export function countryFromLanguage(language?: string | null): string {
  const raw = (language ?? "").trim();
  if (!raw) return "";
  const region = raw.match(/[-_]([A-Za-z]{2})$/)?.[1]?.toUpperCase();
  if (region && COUNTRIES.some((c) => c.code === region)) return region;
  return BY_LANGUAGE[raw.toLowerCase().split(/[-_]/)[0]] ?? "";
}

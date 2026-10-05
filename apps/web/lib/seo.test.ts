import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { CANONICAL_SITE_URL, HOME_DESCRIPTION, HOME_TITLE, canonicalUrl } from "@/lib/seo";

describe("public search metadata", () => {
  it("uses the production origin and a brand-led homepage title", () => {
    expect(canonicalUrl("/")).toBe(`${CANONICAL_SITE_URL}/`);
    expect(HOME_TITLE).toMatch(/^Vello Agents: AI /);
    expect(HOME_DESCRIPTION).toContain("Vello Agents");
  });

  it("only includes unique public URLs in the sitemap", () => {
    const urls = sitemap().map(({ url }) => url);
    expect(urls).toContain(canonicalUrl("/"));
    expect(urls).toContain(canonicalUrl("/clipping"));
    expect(urls).toContain(canonicalUrl("/about"));
    expect(urls).not.toContain(canonicalUrl("/generations"));
    expect(urls.some((url) => url.startsWith(canonicalUrl("/market/")))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

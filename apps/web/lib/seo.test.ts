import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { CANONICAL_SITE_URL, HOME_DESCRIPTION, HOME_TITLE, canonicalUrl, cleanText } from "@/lib/seo";

describe("public search metadata", () => {
  it("uses the production origin and a brand-led homepage title", () => {
    expect(canonicalUrl("/")).toBe(`${CANONICAL_SITE_URL}/`);
    expect(HOME_TITLE).toMatch(/^Solcameo \| AI /);
    expect(HOME_DESCRIPTION).toContain("Solcameo");
  });

  it("keeps em and en dashes out of metadata text", () => {
    expect(HOME_TITLE).not.toMatch(/[\u2014\u2013]/);
    expect(HOME_DESCRIPTION).not.toMatch(/[\u2014\u2013]/);
    expect(cleanText("Luna \u2014 the knight \u2013 cat")).toBe("Luna, the knight, cat");
  });

  it("only includes unique public URLs in the sitemap", async () => {
    const urls = (await sitemap()).map(({ url }) => url);
    expect(urls).toContain(canonicalUrl("/"));
    expect(urls).toContain(canonicalUrl("/clipping"));
    expect(urls).toContain(canonicalUrl("/about"));
    expect(urls).not.toContain(canonicalUrl("/generations"));
    expect(urls).toContain(canonicalUrl("/how-it-works"));
    expect(new Set(urls).size).toBe(urls.length);
  });
});

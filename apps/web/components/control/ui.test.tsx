import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar, Markdown, TeamAvatar } from "./ui";

describe("Control agent avatars", () => {
  it("preserves a saved image when the URL is usable", () => {
    const html = renderToStaticMarkup(<Avatar agent={{ name: "Old Agent", avatarUrl: "https://images.example/old.png" }} size={48} />);
    expect(html).toContain('src="https://images.example/old.png"');
    expect(html).toContain('width:48px;height:48px');
  });

  it("renders a generated portrait for missing or malformed legacy URLs", () => {
    for (const avatarUrl of ["", "not-a-url"]) {
      const html = renderToStaticMarkup(<Avatar agent={{ name: "Old Agent", avatarUrl }} />);
      expect(html).toContain('src="data:image/svg+xml');
      expect(html).toContain('alt="Old Agent"');
    }
  });

  it("uses a saved still when the primary legacy URL is malformed", () => {
    const html = renderToStaticMarkup(<Avatar agent={{
      name: "Old Agent",
      avatarUrl: "not-a-url",
      avatarStills: ["https://media.example/old-still.png"],
    }} />);
    expect(html).toContain('src="https://media.example/old-still.png"');
  });

  it("uses the same resilient avatar for team members", () => {
    const html = renderToStaticMarkup(<TeamAvatar members={[
      { name: "First", avatarUrl: "" },
      { name: "Second", avatarUrl: "broken" },
    ]} />);
    expect(html.match(/src="data:image\/svg\+xml/g)).toHaveLength(2);
  });
});

describe("Markdown streaming cursor", () => {
  it("sits inline at the end of the last paragraph, not on its own line", () => {
    const html = renderToStaticMarkup(<Markdown text={"Hey there\n\nStyling a **batik** fit"} caret animate />);
    expect(html).toMatch(/<p>.*fit<\/span><span class="vello-caret"[^>]*><\/span><\/p><\/div>$/);
    expect(html).toContain('<strong class="font-semibold text-white vello-word">batik</strong>');
  });
  it("ends inside the last list item", () => {
    const html = renderToStaticMarkup(<Markdown text={"- one\n- two"} caret />);
    expect(html).toMatch(/<li>two<span class="vello-caret"[^>]*><\/span><\/li><\/ul>/);
  });
  it("renders plain text (no word spans, no cursor) once settled", () => {
    const html = renderToStaticMarkup(<Markdown text="done" />);
    expect(html).toBe('<div class="space-y-2.5"><p>done</p></div>');
  });
});

import Link from "next/link";
import type { BlogBlock } from "@/lib/blog-posts";

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;
const NEORIS = { fontFamily: "var(--font-neoris), sans-serif" } as const;

export function BlogBlockView({ block }: { block: BlogBlock }) {
  if (block.type === "h2") {
    return (
      <h2 className="mt-10 text-[19px] font-medium tracking-[-0.02em] text-white first:mt-0" style={NEORIS}>
        {block.text}
      </h2>
    );
  }
  if (block.type === "list") {
    return (
      <ul className="mt-4 space-y-2" style={MANROPE}>
        {block.items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[15px] font-light leading-relaxed text-white/60">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-white/30" />
            {item}
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "links") {
    return (
      <ul className="mt-4 space-y-2" style={MANROPE}>
        {block.items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="text-[15px] font-medium text-white/80 underline underline-offset-4 hover:text-white">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="mt-4 text-[15px] font-light leading-relaxed text-white/60" style={MANROPE}>
      {block.text}
    </p>
  );
}

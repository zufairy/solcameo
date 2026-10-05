"use client";

import { Fragment, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderInput,
  Boxes,
  Clapperboard,
  Crop,
  Send,
  GripVertical,
  Search,
  X,
} from "lucide-react";
import {
  CATALOG,
  CATALOG_GROUPS,
  type CatalogKey,
  type CatalogGroup,
} from "@/components/builder/clipping-flow/data/node-catalog";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { CLIP_SKILL_BY_ID, isAppOnlySkill } from "@/lib/builder/clipSkillsCatalog";

// Click-to-add: the store's add actions auto-wire the node into the graph, then a
// Tidy re-lays everything out left-to-right — so the initial drop position is
// irrelevant (Tidy overrides it). This makes a single CLICK place + connect a node,
// with drag-and-drop still working exactly as before.
const ORIGIN = { x: 0, y: 0 };

function useClickAdd() {
  const addNodeFromCatalog = useClippingStore((s) => s.addNodeFromCatalog);
  const addSkillNodeAt = useClippingStore((s) => s.addSkillNodeAt);
  const tidyLayout = useClippingStore((s) => s.tidyLayout);
  const addCatalog = (key: CatalogKey) => {
    addNodeFromCatalog(key, ORIGIN);
    tidyLayout();
  };
  const addSkill = (skillId: string, name: string) => {
    addSkillNodeAt({ skillId, name }, ORIGIN);
    tidyLayout();
  };
  return { addCatalog, addSkill };
}

const ICONS: Record<CatalogKey, typeof FolderInput> = {
  source: FolderInput,
  compose: Boxes,
  broll: Clapperboard,
  crop: Crop,
  publish: Send,
};

const ACCENT: Record<CatalogGroup, string> = {
  Sources: "var(--node-source)",
  Skills: "var(--node-skill)",
  Publish: "var(--node-publish)",
};

// Shared entrance/exit for palette rows so filtering feels smooth (fade + slide,
// laid out with `layout` so surviving rows glide to their new position).
const ROW_MOTION = {
  layout: true,
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
  transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const },
} as const;

const norm = (s: string) => s.toLowerCase();

/**
 * Installed marketplace clipping skills (the Library) as click/drag palette rows,
 * filtered live by the search box. Dropping/clicking one lands a marketplace skill
 * node carrying its skillId, auto-wired into the graph.
 */
function OwnedSkillsSection({ query }: { query: string }) {
  const availableSkills = useClippingStore((s) => s.availableSkills);
  const { addSkill } = useClickAdd();
  const q = norm(query.trim());

  // Filter by name / skillId / marketplace tag, then group by tag so a big library
  // stays scannable. Recomputed as availableSkills OR the query changes → always live
  // (fixes the stale list after installing/removing a skill).
  const groups = useMemo(() => {
    const m = new Map<string, typeof availableSkills>();
    for (const s of availableSkills) {
      // App-only installs (Photo Carousel Builder) unlock a builder TAB, not a
      // canvas node — never show them as draggable skill nodes.
      if (isAppOnlySkill(s.skillId)) continue;
      const tag = CLIP_SKILL_BY_ID[s.skillId]?.tag ?? "Skills";
      if (q && !(norm(s.name).includes(q) || norm(s.skillId).includes(q) || norm(tag).includes(q))) continue;
      if (!m.has(tag)) m.set(tag, []);
      m.get(tag)!.push(s);
    }
    return m;
  }, [availableSkills, q]);

  const matched = [...groups.values()].reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-300">
        Your skills
      </div>
      {availableSkills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-2.5 py-2 text-[11px] text-zinc-400">
          No skills installed yet - get some in the Marketplace tab.
        </div>
      ) : matched === 0 ? (
        <div className="px-1 text-[11px] text-zinc-500">No skills match &ldquo;{query.trim()}&rdquo;.</div>
      ) : (
        <AnimatePresence initial={false}>
          {[...groups.entries()].map(([tag, skills]) => (
            <motion.div key={tag} {...ROW_MOTION} className="space-y-1.5">
              {!q && (
                <div className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  {tag}
                </div>
              )}
              {skills.map((s) => (
                <motion.div
                  key={s.skillId}
                  {...ROW_MOTION}
                  role="button"
                  tabIndex={0}
                  draggable
                  onClick={() => addSkill(s.skillId, s.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addSkill(s.skillId, s.name); } }}
                  onDragStart={(e) => {
                    // motion.div types onDragStart as its drag GESTURE; we use the
                    // native HTML5 drag (no framer `drag` prop), so the event really
                    // is a DragEvent with dataTransfer — cast to reach it.
                    const dt = (e as unknown as { dataTransfer: DataTransfer }).dataTransfer;
                    dt.setData("application/vello-skill", JSON.stringify({ skillId: s.skillId, name: s.name }));
                    dt.effectAllowed = "move";
                  }}
                  className="group flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 bg-background/50 px-2.5 py-2 transition-colors hover:border-foreground/20 hover:bg-accent/50 active:cursor-grabbing"
                >
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-[15px]"
                    style={{ background: "color-mix(in oklch, var(--node-skill) 20%, transparent)" }}
                  >
                    {s.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-tight text-zinc-100">{s.name}</div>
                    <div className="truncate text-[11px] text-zinc-400">Marketplace skill</div>
                  </div>
                  <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40" />
                </motion.div>
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

export function NodePalette() {
  const { addCatalog } = useClickAdd();
  const [query, setQuery] = useState("");
  const q = norm(query.trim());

  // Catalog rows matching the query (title / description / group).
  const catalogByGroup = useMemo(() => {
    return CATALOG_GROUPS.map((group) => ({
      group,
      items: CATALOG.filter(
        (c) =>
          c.group === group &&
          (!q || norm(c.title).includes(q) || norm(c.description).includes(q) || norm(group).includes(q)),
      ),
    }));
  }, [q]);

  return (
    <aside className="flex max-h-[62vh] w-64 flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold text-white">Add a node</div>
        <div className="text-xs text-muted-foreground">Search, then click to add (or drag)</div>
        {/* Live search across catalog nodes + your installed skills. */}
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes & skills…"
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} title="Clear" className="text-muted-foreground transition-colors hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-3">
          <AnimatePresence initial={false}>
            {catalogByGroup.map(({ group, items }) => {
              const showSkills = group === "Skills";
              if (items.length === 0 && !showSkills) return null;
              return (
                <Fragment key={group}>
                  {items.length > 0 && (
                    <motion.div {...ROW_MOTION} className="space-y-1.5">
                      <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-300">{group}</div>
                      {items.map((item) => {
                        const Icon = ICONS[item.key];
                        if (item.disabled) {
                          return (
                            <motion.div
                              key={item.key}
                              {...ROW_MOTION}
                              title="Coming soon"
                              aria-disabled
                              className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/30 px-2.5 py-2 opacity-45 cursor-not-allowed select-none"
                            >
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-500/15 text-zinc-500">
                                <Icon className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium leading-tight text-zinc-400">{item.title}</div>
                                <div className="truncate text-[11px] text-zinc-500">{item.description}</div>
                              </div>
                              <span className="shrink-0 rounded-full border border-zinc-600/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Soon</span>
                            </motion.div>
                          );
                        }
                        return (
                          <motion.div
                            key={item.key}
                            {...ROW_MOTION}
                            role="button"
                            tabIndex={0}
                            draggable
                            onClick={() => addCatalog(item.key)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addCatalog(item.key); } }}
                            onDragStart={(e) => {
                              const dt = (e as unknown as { dataTransfer: DataTransfer }).dataTransfer;
                              dt.setData("application/vello-node", item.key);
                              dt.effectAllowed = "move";
                            }}
                            className="group flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 bg-background/50 px-2.5 py-2 transition-colors hover:border-foreground/20 hover:bg-accent/50 active:cursor-grabbing"
                          >
                            <span
                              className="flex size-7 shrink-0 items-center justify-center rounded-md"
                              style={{ background: `color-mix(in oklch, ${ACCENT[group]} 20%, transparent)`, color: ACCENT[group] }}
                            >
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium leading-tight text-zinc-100">{item.title}</div>
                              <div className="truncate text-[11px] text-zinc-400">{item.description}</div>
                            </div>
                            <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40" />
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                  {showSkills && <OwnedSkillsSection query={query} />}
                </Fragment>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </aside>
  );
}

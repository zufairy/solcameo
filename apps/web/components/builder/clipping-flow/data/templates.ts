import type {
  VelloNode,
  VelloEdge,
  NodeConfig,
  NodeKind,
} from "@/components/builder/clipping-flow/types/clipping";
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";

/**
 * Saved clipper templates - "pick a template and hit go". Each is a factory
 * producing a complete, pre-wired node graph (the 2-week plan's Week-1
 * deliverable: templates are saved node graphs, proving the builder is a
 * builder). Clipper-only by design; the faceless/influencer path is out of
 * scope this sprint.
 *
 * build() mints FRESH node ids per call (tpl-scoped counter + random suffix)
 * so re-applying a template, or mixing with palette-dropped nodes (store
 * nodeSeq ids), can never collide. Positions sit on the Tidy grid
 * (COL=320 / ROW=150 - see clipping-store tidyLayout) so the graph lands
 * already arranged.
 */
export interface ClipTemplate {
  id:
    | "blank-canvas"
    | "podcast-clipper"
    | "hormozi-bold"
    | "brainrot-split"
    | "meme-machine"
    | "breaking-news"
    | "aesthetic-vibes"
    | "campaign-hunter";
  name: string;
  /** Emoji fallback shown when the image is missing / still loading. */
  icon: string;
  /** Thumbnail image (public/ path). Style-representative art, not a real person. */
  image?: string;
  tagline: string;
  /** One-line "who this is for" so the operator knows which to pick. */
  useCase: string;
  /** Chip row for the picker card, in flow order. */
  nodeSummary: string[];
  /** Marketplace skills the template uses - auto-installed on apply. */
  skillIds: string[];
  build(): { nodes: VelloNode[]; edges: VelloEdge[] };
}

let tplSeq = 0;

const COL = 320;
const ROW = 150;

function freshId(slug: string): string {
  return `${slug}-tpl${tplSeq++}-${Math.random().toString(36).slice(2, 7)}`;
}

function node(id: string, kind: NodeKind, title: string, col: number, row: number, config: NodeConfig): VelloNode {
  return {
    id,
    type: kind,
    position: { x: col * COL, y: 200 + row * ROW },
    data: { kind, title, status: "idle", config },
  };
}

function skillNode(id: string, skillId: string, col: number, row: number, extras: Record<string, unknown> = {}): VelloNode {
  const meta = CLIP_SKILL_BY_ID[skillId];
  return node(id, "skill", meta?.name ?? skillId, col, row, {
    variant: "marketplace",
    skillId,
    skillName: meta?.name ?? skillId,
    ...extras,
  } as NodeConfig);
}

const edge = (source: string, target: string): VelloEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "smoothstep",
});

/**
 * Wire the Compose hub topology: Source -> Compose -> Publish, with EVERY skill
 * hanging off Compose (Compose -> skill) rather than chained inline. Mirrors the
 * store's runtime shape (ensureComposeId / auto-attach), so a template lands in
 * the same hub layout new skills snap into. Skills get sane distinct positions
 * here; tidyLayout re-lays them out strictly left-to-right by layer anyway.
 */
function hub(src: VelloNode, compose: VelloNode, skills: VelloNode[], publish: VelloNode): VelloEdge[] {
  return [
    edge(src.id, compose.id),
    edge(compose.id, publish.id),
    ...skills.map((s) => edge(compose.id, s.id)),
  ];
}

export const CLIP_TEMPLATES: ClipTemplate[] = [
  {
    id: "blank-canvas",
    name: "Blank Canvas",
    icon: "⬜",
    tagline: "Just the rails — Source → Compose → Publish. Add the apps yourself.",
    useCase: "Starting from scratch, or clearing a graph you no longer want.",
    // The three nodes are the pipeline's spine, not a style choice: without them
    // there is nothing to run. Everything else is the operator's to add.
    nodeSummary: ["Source", "Compose", "Publish"],
    // No skills — applying this must not install anything, which is the point of
    // picking it over a styled template.
    skillIds: [],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 20,
        clipLengthMax: 45,
        maxClips: 2,
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const publish = node(freshId("publish"), "publish", "Publish", 2, 0, {
        channel: "tiktok",
        caption: "",
        schedule: "now",
      } as NodeConfig);
      return { nodes: [src, compose, publish], edges: hub(src, compose, [], publish) };
    },
  },
  {
    id: "podcast-clipper",
    name: "Podcast Clipper",
    icon: "🎙️",
    image: "/templates/podcast.jpg",
    tagline: "Talking-head episodes → face-tracked, captioned highlight clips.",
    useCase: "Long podcast / interview recordings you want auto-cut into clean, subtitled highlights.",
    nodeSummary: ["Source", "Face Track", "Dynamic Captions", "Filler Cut", "Publish"],
    skillIds: ["clip.facetrack", "clip.captions", "clip.fillercut"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 25,
        clipLengthMax: 60,
        maxClips: 3,
        genre: "podcast",
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const face = skillNode(freshId("facetrack"), "clip.facetrack", 2, -1);
      const captions = skillNode(freshId("captions"), "clip.captions", 2, 0, { captionPreset: "karaoke" });
      const filler = skillNode(freshId("fillercut"), "clip.fillercut", 2, 1);
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "tiktok",
        caption: "best moments from the pod 🎙️ #podcast",
        schedule: "now",
      } as NodeConfig);
      const skills = [face, captions, filler];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
  {
    id: "hormozi-bold",
    name: "Hormozi Bold",
    icon: "💥",
    image: "/templates/hormozi.jpg",
    tagline: "Punchy caps, green money words, zoom punches - maximum retention.",
    useCase: "Value / business / self-improvement talking clips that need to hold attention to the last second.",
    nodeSummary: ["Source", "Mozi Captions", "Keyword Pop", "Auto Hook", "Zoom Punch", "Publish"],
    skillIds: ["clip.captions", "clip.keywords", "clip.hook", "clip.zoom"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 20,
        clipLengthMax: 45,
        maxClips: 3,
        clipFeel: "shocking",
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const captions = skillNode(freshId("captions"), "clip.captions", 2, -2, { captionPreset: "mozi" });
      const keywords = skillNode(freshId("keywords"), "clip.keywords", 2, -1);
      const hook = skillNode(freshId("hook"), "clip.hook", 2, 1);
      const zoom = skillNode(freshId("zoom"), "clip.zoom", 2, 2);
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "tiktok",
        caption: "watch till the end 💥 #fyp",
        schedule: "now",
      } as NodeConfig);
      const skills = [captions, keywords, hook, zoom];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
  {
    id: "brainrot-split",
    name: "Brainrot Split",
    icon: "🧠",
    image: "/templates/brainrot.jpg",
    tagline: "Gameplay under the clip + bouncy captions + reaction SFX - endless-scroll bait.",
    useCase: "Faceless / story / commentary clips styled like the split-screen brainrot that dominates the FYP.",
    nodeSummary: ["Source", "Brain Rot", "Beasty Captions", "Meme SFX", "Keyword Pop", "Publish"],
    skillIds: ["clip.brainrot", "clip.captions", "clip.memeaudio", "clip.keywords"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 20,
        clipLengthMax: 45,
        maxClips: 3,
        clipFeel: "shocking",
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const brainrot = skillNode(freshId("brainrot"), "clip.brainrot", 2, -2);
      const captions = skillNode(freshId("captions"), "clip.captions", 2, -1, { captionPreset: "beasty" });
      const sfx = skillNode(freshId("memeaudio"), "clip.memeaudio", 2, 1);
      const keywords = skillNode(freshId("keywords"), "clip.keywords", 2, 2);
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "tiktok",
        caption: "you won't scroll past this 🧠 #fyp",
        schedule: "now",
      } as NodeConfig);
      const skills = [brainrot, captions, sfx, keywords];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
  {
    id: "meme-machine",
    name: "Meme Machine",
    icon: "😹",
    image: "/templates/meme.jpg",
    tagline: "Meme text overlays, reaction SFX and zoom punches on the funniest beats.",
    useCase: "Reaction / comedy / fail clips that live or die on meme timing and punchy overlays.",
    nodeSummary: ["Source", "Meme Text", "Meme SFX", "Zoom Punch", "Bounce Captions", "Publish"],
    skillIds: ["clip.meme", "clip.memeaudio", "clip.zoom", "clip.captions"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 12,
        clipLengthMax: 35,
        maxClips: 4,
        clipFeel: "funny",
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const meme = skillNode(freshId("meme"), "clip.meme", 2, -2);
      const sfx = skillNode(freshId("memeaudio"), "clip.memeaudio", 2, -1);
      const zoom = skillNode(freshId("zoom"), "clip.zoom", 2, 1);
      const captions = skillNode(freshId("captions"), "clip.captions", 2, 2, { captionPreset: "bounce" });
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "tiktok",
        caption: "wait for it 😹 #meme",
        schedule: "now",
      } as NodeConfig);
      const skills = [meme, sfx, zoom, captions];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
  {
    id: "breaking-news",
    name: "Breaking News",
    icon: "📰",
    image: "/templates/news.jpg",
    tagline: "A breaking-news title slate + bold hook + smooth transition into the clip.",
    useCase: "Hot takes, commentary and reactions that hit harder opening on a news-style headline card.",
    nodeSummary: ["Source", "Title Card", "Auto Hook", "Dynamic Captions", "Transitions", "Publish"],
    skillIds: ["clip.title", "clip.hook", "clip.captions", "clip.transitions"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 18,
        clipLengthMax: 45,
        maxClips: 3,
        clipFeel: "shocking",
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const title = skillNode(freshId("title"), "clip.title", 2, -2, { titleTemplateId: "breaking_news" });
      const hook = skillNode(freshId("hook"), "clip.hook", 2, -1, { hookTemplateId: "bold_impact" });
      const captions = skillNode(freshId("captions"), "clip.captions", 2, 1, { captionPreset: "default" });
      const transitions = skillNode(freshId("transitions"), "clip.transitions", 2, 2, { transitionId: "slide_up", transitionDurationSec: 0.45 });
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "tiktok",
        caption: "BREAKING 📰 #news #fyp",
        schedule: "now",
      } as NodeConfig);
      const skills = [title, hook, captions, transitions];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
  {
    id: "aesthetic-vibes",
    name: "Aesthetic Vibes",
    icon: "🌿",
    tagline: "Trending audio, a warm color grade, a clean title and smooth fades.",
    useCase: "Lifestyle, travel, fashion and b-roll edits that should feel calm, premium and on-trend.",
    nodeSummary: ["Source", "Trending Audio", "Video Filters", "Title Card", "Transitions", "Publish"],
    skillIds: ["clip.trendingaudio", "clip.filters", "clip.title", "clip.captions", "clip.transitions"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 15,
        clipLengthMax: 40,
        maxClips: 4,
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const audio = skillNode(freshId("audio"), "clip.trendingaudio", 2, -2, { autoMusic: true });
      const filters = skillNode(freshId("filters"), "clip.filters", 2, -1, { filterPreset: "warm" });
      const title = skillNode(freshId("title"), "clip.title", 2, 0, { titleTemplateId: "world_report" });
      const captions = skillNode(freshId("captions"), "clip.captions", 2, 1, { captionPreset: "mono" });
      const transitions = skillNode(freshId("transitions"), "clip.transitions", 2, 2, { transitionId: "fade", transitionDurationSec: 0.5 });
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "instagram",
        caption: "a little moment 🌿",
        schedule: "now",
      } as NodeConfig);
      const skills = [audio, filters, title, captions, transitions];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
  {
    id: "campaign-hunter",
    name: "Campaign Hunter",
    icon: "🎯",
    tagline: "Clips a source, finds matching brand campaigns, drips + auto-submits.",
    useCase: "You want your clips matched to paying brand bounties and posted on a schedule to earn.",
    nodeSummary: ["Source", "Campaign Scout", "Prompt to Clip", "Dynamic Captions", "Publish (drip)"],
    skillIds: ["clip.campaignscout", "clip.prompt", "clip.captions"],
    build() {
      const src = node(freshId("source"), "source", "Source", 0, 0, {
        provider: "google-drive",
        sourceUrl: "",
        clipLengthMin: 20,
        clipLengthMax: 45,
        maxClips: 5,
      } as NodeConfig);
      const compose = node(freshId("compose"), "compose", "Compose", 1, 0, {});
      const scout = skillNode(freshId("scout"), "clip.campaignscout", 2, -1, { campaignIds: [] });
      const prompt = skillNode(freshId("prompt"), "clip.prompt", 2, 0, { prompt: "" });
      const captions = skillNode(freshId("captions"), "clip.captions", 2, 1, { captionPreset: "default" });
      const publish = node(freshId("publish"), "publish", "Publish", 3, 0, {
        channel: "tiktok",
        caption: "fresh clips, on schedule 🎯",
        schedule: "scheduled",
      } as NodeConfig);
      const skills = [scout, prompt, captions];
      const nodes = [src, compose, ...skills, publish];
      return { nodes, edges: hub(src, compose, skills, publish) };
    },
  },
];

export const TEMPLATE_BY_ID: Record<string, ClipTemplate> = Object.fromEntries(
  CLIP_TEMPLATES.map((t) => [t.id, t]),
);

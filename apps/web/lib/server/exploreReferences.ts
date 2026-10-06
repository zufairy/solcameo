import references from "@/lib/explore/references.json";

export interface ServerReference { id: string; title: string; videoUrl: string; thumbUrl?: string; duration: number; category: string }
let byId: Map<string, ServerReference> | null = null;

/** Trusted reference data. Price and the source video come from here, never from the client. */
export function getReference(id: string): ServerReference | null {
  if (!byId) {
    byId = new Map();
    for (const r of references.items as ServerReference[]) if (r.id && r.videoUrl) byId.set(r.id, r);
  }
  return byId.get(id) ?? null;
}

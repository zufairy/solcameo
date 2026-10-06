"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";

const MESSAGES: Record<string, string> = { invalid_link: "Use full https links. The X link must be on x.com or twitter.com.", not_owner: "Only the creator can edit these links." };

/** Owner-only editor for the X and website links shown beside the token in Trending. */
export function SocialLinksForm({ characterId, xUrl = "", websiteUrl = "" }: { characterId: string; xUrl?: string; websiteUrl?: string }) {
  const [open, setOpen] = useState(false);
  const [x, setX] = useState(xUrl), [web, setWeb] = useState(websiteUrl);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      if (!getCurrentSiwsToken()) await ensureSiwsViaRegistered();
      const res = await fetch("/api/solstar/social-links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId, xUrl: x.trim(), websiteUrl: web.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(MESSAGES[data.error] ?? "Could not save links. Try again.");
      setMsg({ ok: true, text: "Saved. Icons now show beside your token in Trending." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save links." }); }
    finally { setBusy(false); }
  }
  return <>
    <div className="px-3 pb-3"><Button variant="outline" size="sm" onClick={() => setOpen(true)} className="border-white/10 bg-white/[0.03] text-xs text-zinc-300"><Globe className="size-3.5" />Edit public links</Button></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="border-white/10 bg-[#202326] text-white sm:max-w-sm"><DialogTitle>Public links</DialogTitle><DialogDescription>Manage the X and website links for your influencer.</DialogDescription><div className="space-y-3">
    <p className="text-[11px] text-zinc-500">Optional. Icons appear in Trending only for links you add.</p>
    <Input value={x} onChange={e => setX(e.target.value)} maxLength={200} placeholder="https://x.com/yourhandle" aria-label="X link" className="h-9 border-white/10 text-xs" />
    <Input value={web} onChange={e => setWeb(e.target.value)} maxLength={200} placeholder="https://yourwebsite.com" aria-label="Website link" className="h-9 border-white/10 text-xs" />
    <div className="flex items-center gap-3"><Button size="sm" disabled={busy} onClick={() => void save()} className="bg-[#d7ff00] text-black hover:bg-[#e4ff59]">{busy && <Loader2 className="size-3.5 animate-spin" />}Save links</Button>{msg && <p role={msg.ok ? "status" : "alert"} className={`text-[11px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}</div>
  </div></DialogContent></Dialog>
  </>;
}

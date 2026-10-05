"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import Image from "next/image";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COUNTRIES } from "@/lib/node/countries";
import styles from "./node.module.css";

/* ── The call: every Friday 9pm (Kuala Lumpur, UTC+8 = 13:00 UTC), 90 minutes ── */
const CALL_UTC_DAY = 5, CALL_UTC_HOUR = 13, CALL_LEN_MS = 90 * 60_000, WEEK = 7 * 86_400_000;

function nextCall(now: number) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CALL_UTC_HOUR);
  let t = start + ((CALL_UTC_DAY - d.getUTCDay() + 7) % 7) * 86_400_000;
  if (now > t + CALL_LEN_MS) t += WEEK;
  return t;
}

/** Reveals `[data-reveal]` children as they scroll in; content stays visible without JS. */
export function Experience({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).dataset.visible = "true"; io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    el.querySelectorAll<HTMLElement>("[data-reveal]").forEach((n) => { if (reduced || n.getBoundingClientRect().top < window.innerHeight * 0.95) n.dataset.visible = "true"; else io.observe(n); });
    el.dataset.enhanced = "true";
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const max = document.documentElement.scrollHeight - window.innerHeight; el.style.setProperty("--progress", String(max > 0 ? Math.min(1, window.scrollY / max) : 0)); }); };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    // cursor spotlight: any [data-spot] element gets --mx/--my so its glow follows the pointer
    const onPointer = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.("[data-spot]") as HTMLElement | null;
      if (!t || e.pointerType === "touch") return;
      const r = t.getBoundingClientRect();
      t.style.setProperty("--mx", `${e.clientX - r.left}px`); t.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", onPointer, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); el.removeEventListener("pointermove", onPointer); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={root} className={styles.experience}><div className={styles.progress} aria-hidden="true" />{children}</div>;
}

export function Countdown({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const first = setTimeout(() => setNow(Date.now()), 0), id = setInterval(() => setNow(Date.now()), 1000); return () => { clearTimeout(first); clearInterval(id); }; }, []);
  if (now === null) return <div className={compact ? styles.cdCompact : styles.countdown} aria-hidden="true" style={{ visibility: "hidden" }}>00</div>;
  const at = nextCall(now), left = at - now, live = left <= 0;
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const parts: [string, string][] = [[p(left / 86_400_000), "Days"], [p((left / 3_600_000) % 24), "Hours"], [p((left / 60_000) % 60), "Minutes"], [p((left / 1000) % 60), "Seconds"]];
  if (compact) return <span className={styles.cdCompact}>{live ? "Live now" : `${parts[0][0]}d ${parts[1][0]}h ${parts[2][0]}m`}</span>;
  const local = new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
  return <div className={styles.countdown}>
    {live ? <p className={styles.liveNow}><span />The call is live now</p> : <div className={styles.cdGrid} role="timer" aria-label="Time until the next Operators Call">
      {parts.map(([v, l]) => <div key={l}><b>{v}</b><small>{l}</small></div>)}</div>}
    <p className={styles.cdLocal}>Next call · {local}</p>
  </div>;
}

function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => { const el = ref.current; if (!el) return; const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.4 }); io.observe(el); return () => io.disconnect(); }, []);
  return [ref, seen] as const;
}

function Counter({ value, label, hint }: { value: number | undefined; label: string; hint: string }) {
  const [ref, seen] = useVisible<HTMLDivElement>();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen || value === undefined) return;
    const span = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1800;
    let raf = 0; const t0 = performance.now(), from = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / span); setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 4)))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [seen, value]);
  return <div ref={ref} className={styles.counter}><b>{value === undefined ? "..." : shown.toLocaleString("en-US")}</b><span>{label}</span><small>{hint}</small></div>;
}

function NodeAvatar({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={styles.nodeAvatar} aria-hidden="true">
    <span>{name.slice(0, 1).toUpperCase()}</span>
    {src && !failed && <Image src={src} alt="" width={44} height={44} unoptimized loading="lazy" onError={() => setFailed(true)} />}
  </span>;
}

const DAY = 86_400_000;
const clean = (s: string) => s.replace(/[^A-Za-z0-9À-ÿ .,_'&+!-]/g, "").trim() || "A new agent";
const ago = (ms: number) => { const h = Math.floor(ms / 3_600_000); return h < 1 ? `${Math.max(1, Math.floor(ms / 60_000))} minutes ago` : h < 24 ? `${h} hours ago` : `${Math.floor(h / 24)} days ago`; };

/** Live, cheap network numbers straight from the agent roster. */
export function LiveLedger() {
  const roster = useQuery(api.tournament.roster, {});
  const [now] = useState(() => Date.now());
  const stats = useMemo(() => {
    if (!roster) return null;
    const fresh = [...roster].sort((a, b) => b.createdAt - a.createdAt);
    return { total: roster.length, today: roster.filter((a) => a.createdAt >= now - DAY).length, week: roster.filter((a) => a.createdAt >= now - 7 * DAY).length, newest: fresh.slice(0, 4).map((a) => ({ id: a.mintAddress, name: clean(a.name), avatarUrl: a.avatarUrl, ago: ago(now - a.createdAt) })) };
  }, [roster, now]);
  return <div className={styles.ledger}>
    <div className={styles.counters}>
      <Counter value={stats?.total} label="Agents on the network" hint="and counting" />
      <Counter value={stats?.week} label="Minted this week" hint="the founding hour is now" />
      <Counter value={stats?.today} label="Minted today" hint="in the last 24 hours" />
    </div>
    <div className={styles.newest}>
      <h3>Newest nodes</h3>
      {stats ? <ol>{stats.newest.map((n, i) => <li key={n.id} style={{ ["--i" as string]: i }}><NodeAvatar name={n.name} src={n.avatarUrl} /><span className={styles.nodeIdentity}><b>{n.name}</b><em>{n.ago}</em></span></li>)}</ol> : <p>Reading the ledger…</p>}
    </div>
  </div>;
}

/** Card that leans toward the pointer and catches a moving glare. */
export function Tilt({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - y) * 5}deg`); el.style.setProperty("--ry", `${(x - 0.5) * 6}deg`);
    el.style.setProperty("--gx", `${x * 100}%`); el.style.setProperty("--gy", `${y * 100}%`);
  };
  const reset = () => { const el = ref.current; if (!el) return; el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); };
  return <div ref={ref} className={`${styles.tilt} ${className}`} onPointerMove={move} onPointerLeave={reset}>{children}</div>;
}

/** Anonymous registration counters, shown only once they are worth showing. */
export function SocialProof({ light = false }: { light?: boolean }) {
  const s = useQuery(api.nodeApplications.publicStats, {});
  if (!s || s.total < 10) return null;
  return <p className={`${styles.proof} ${light ? styles.proofLight : ""}`}><i aria-hidden="true" /><b>{s.total.toLocaleString("en-US")}</b> operators have reserved a seat{s.week > 0 && <> &middot; <b>{s.week.toLocaleString("en-US")}</b> this week</>}</p>;
}

const PURPOSES = [
  { id: "business", title: "For my business", text: "Put an always-on content engine behind my brand." },
  { id: "agents", title: "Make agents work for me", text: "Run nodes that post, rank and earn on the network." },
  { id: "both", title: "Both", text: "Grow my business and run a fleet of earning agents." },
] as const;

export function ApplyForm() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const [done, setDone] = useState({ email: "", purpose: "" });
  const [purpose, setPurpose] = useState<string>("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!data.purpose) { setError("Please choose what you want a node for."); return; }
    setState("busy"); setError("");
    try {
      const r = await fetch("/api/node/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || "Something went wrong. Please try again.");
      setDone({ email: data.email, purpose: data.purpose }); setState("done");
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); setState("idle"); }
  }
  if (state === "done") return <div className={styles.seal} role="status">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" /><circle cx="60" cy="60" r="46" /><path d="M38 61l16 16 29-34" /></svg>
    <h3>Your seat is reserved</h3>
    <p>Welcome, operator. We will send the webinar link to <b>{done.email}</b> before Friday&rsquo;s call{done.purpose === "business" ? ", and bring a few ideas for putting a node to work in your business." : done.purpose === "agents" ? ", and show you how to put your first agent to work." : ", and show you how to grow your business and your fleet together."}</p>
  </div>;
  return <form className={styles.form} onSubmit={submit} noValidate={false}>
    <fieldset className={styles.purposes}>
      <legend>What would you use a node for?</legend>
      {PURPOSES.map((p) => <label key={p.id} className={`${styles.purpose} ${purpose === p.id ? styles.purposeOn : ""}`}>
        <input type="radio" name="purpose" value={p.id} required checked={purpose === p.id} onChange={() => setPurpose(p.id)} /><b>{p.title}</b><span>{p.text}</span>
      </label>)}
    </fieldset>
    <div className={styles.row}>
      <div className={styles.field}><label htmlFor="n-name">Full name</label><input id="n-name" name="name" required maxLength={120} autoComplete="name" placeholder="Ada Lovelace" /></div>
      <div className={styles.field}><label htmlFor="n-email">Email</label><input id="n-email" name="email" type="email" required maxLength={160} autoComplete="email" placeholder="you@domain.com" /></div>
    </div>
    <div className={styles.row}>
      <div className={styles.field}><label htmlFor="n-phone">Phone <i>(with country code)</i></label><input id="n-phone" name="phone" type="tel" required maxLength={32} autoComplete="tel" inputMode="tel" minLength={7} title="e.g. +60 12 345 6789" placeholder="+60 12 345 6789" /></div>
      <div className={styles.field}><label htmlFor="n-country">Country</label>
        <select id="n-country" name="country" required defaultValue="" autoComplete="country-name"><option value="" disabled>Choose your country</option>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
    </div>
    {(purpose === "business" || purpose === "both") && <div className={`${styles.field} ${styles.reveal}`}><label htmlFor="n-biz">Business name <i>(optional)</i></label><input id="n-biz" name="businessName" maxLength={120} autoComplete="organization" placeholder="Your company or brand" /></div>}
    <div className={styles.row}>
      <div className={styles.field}><label htmlFor="n-exp">Agents you run today</label>
        <select id="n-exp" name="experience" defaultValue="none"><option value="none">None yet, ready to start</option><option value="1-5">1 – 5</option><option value="6-20">6 – 20</option><option value="20+">More than 20</option></select></div>
      <div className={styles.field}><label htmlFor="n-tg">Telegram <i>(optional)</i></label><input id="n-tg" name="telegram" maxLength={80} placeholder="@handle" /></div>
    </div>
    <input className={styles.honey} name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" className={styles.cta} disabled={state === "busy"}><span>{state === "busy" ? "Reserving…" : "Reserve my seat"}</span><i aria-hidden="true" /></button>
    <p className={styles.fine}>Free to attend. We only use your details to send the call link and follow up about your node.</p>
  </form>;
}

/** Slim bar that appears on phones once the hero has scrolled away. */
export function StickyCta() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => { const r = document.getElementById("reserve")?.getBoundingClientRect(); setShow(window.scrollY > window.innerHeight * 0.8 && !(r && r.top < window.innerHeight * 0.7)); };
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return <a href="#reserve" className={styles.sticky} data-show={show} aria-hidden={!show} tabIndex={show ? 0 : -1}><span>Friday · 9PM</span><b><Countdown compact /></b><em>Reserve →</em></a>;
}

const NAV = [["node", "Network"], ["paths", "Paths"], ["perks", "Perks"], ["road", "Journey"], ["ladder", "Ladder"], ["program", "Programme"]] as const;

/** Fixed glass navigation: transparent over the hero, blurred once scrolled, with the section you are in lit up. */
export function NodeNav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("");
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: "-45% 0px -50% 0px" });
    NAV.forEach(([id]) => { const n = document.getElementById(id); if (n) io.observe(n); });
    return () => { window.removeEventListener("scroll", onScroll); io.disconnect(); };
  }, []);
  return <nav className={styles.nav} data-scrolled={scrolled} aria-label="Operators Call">
    <div className={styles.navInner}>
      <a href="/" className={styles.navLogo} aria-label="Vello home"><Image src="/vello-logo-white.png" alt="Vello" width={110} height={33} priority /></a>
      <ul className={styles.navLinks}>{NAV.map(([id, label]) => <li key={id}><a href={`#${id}`} data-active={active === id}>{label}</a></li>)}</ul>
      <a href="#reserve" className={styles.navCta}><span>Reserve a seat</span></a>
    </div>
  </nav>;
}

/** Live network figures for the hero, read from the same roster the ledger uses. */
export function HeroStats() {
  const roster = useQuery(api.tournament.roster, {});
  const [now] = useState(() => Date.now());
  const apps = useQuery(api.nodeApplications.publicStats, {});
  const stats = useMemo(() => roster ? { total: roster.length, week: roster.filter((a) => a.createdAt >= now - 7 * DAY).length, today: roster.filter((a) => a.createdAt >= now - DAY).length } : null, [roster, now]);
  const cell = (value: number | undefined, label: string) => <div><b><CountUp value={value} /></b><span>{label}</span></div>;
  return <div className={styles.heroStats} role="group" aria-label="The network right now">
    <p className={styles.heroStatsLive}><i aria-hidden="true" />Live</p>
    {cell(stats?.total, "Agents on the network")}
    {cell(stats?.week, "Minted this week")}
    {cell(stats?.today, "Minted today")}
    {apps && apps.total >= 10 ? cell(apps.total, "Seats reserved") : null}
  </div>;
}

function CountUp({ value }: { value: number | undefined }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (value === undefined) return;
    const span = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1600;
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / span); setShown(Math.round(value * (1 - Math.pow(1 - k, 4)))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{value === undefined ? "\u2013" : shown.toLocaleString("en-US")}</>;
}

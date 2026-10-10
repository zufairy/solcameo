import { createAggregator, type Aggregator, type BlurEvent } from "./pulseAggregate";
import { SOLAMI_BLUR_WS, solamiDataKey } from "./blur";

/**
 * One shared Blur WebSocket per server process, however many browsers watch. Blur bills per delivered byte (the full mainnet
 * firehose is roughly 370 KB/s), so the socket opens only while /api/pulse is being polled and closes after IDLE_MS of silence.
 */
const IDLE_MS = 45_000;
const TYPES = "swap,token_create,pool_create,liquidity,surge,graduation,metadata";

export type StreamHealth = {
  state: "idle" | "connecting" | "live" | "reconnecting" | "paused" | "unconfigured";
  region: string | null; connectedSince: number | null; lastMessageAt: number | null;
  messagesPerSecond: number; totalMessages: number; reconnects: number; lagSeconds: number | null; note?: string;
};

class PulseHub {
  readonly agg: Aggregator = createAggregator();
  private ws: WebSocket | null = null;
  private lastTouch = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private health: StreamHealth = { state: "idle", region: null, connectedSince: null, lastMessageAt: null, messagesPerSecond: 0, totalMessages: 0, reconnects: 0, lagSeconds: null };
  private rate = { at: Date.now(), count: 0 };

  /** Called on every poll: keeps (or starts) the stream alive. */
  touch() {
    this.lastTouch = Date.now();
    if (!solamiDataKey()) { this.health.state = "unconfigured"; return; }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_MS);
    if (!this.ws && !this.retryTimer && this.health.state !== "paused") this.connect();
  }

  snapshot(): StreamHealth {
    const now = Date.now();
    if (now - this.rate.at >= 1000) { this.health.messagesPerSecond = Math.round((this.rate.count * 1000) / (now - this.rate.at)); this.rate = { at: now, count: 0 }; }
    return { ...this.health, lagSeconds: this.agg.lagSeconds(now) };
  }

  /** An out-of-bandwidth pause is cleared by an explicit retry (a new viewer after a top-up). */
  resume() { if (this.health.state === "paused") { this.health.state = "idle"; this.backoff = 1000; } }

  private connect() {
    this.health.state = this.health.reconnects ? "reconnecting" : "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${SOLAMI_BLUR_WS}?chain=solana&api_key=${encodeURIComponent(solamiDataKey())}&type=${TYPES}`);
    } catch { return this.scheduleRetry(); }
    this.ws = ws;
    ws.onopen = () => { this.backoff = 1000; };
    ws.onmessage = (m) => {
      this.health.totalMessages++; this.rate.count++; this.health.lastMessageAt = Date.now();
      let e: BlurEvent;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (e.type === "connected") { this.health.state = "live"; this.health.region = String(e.region ?? ""); this.health.connectedSince = Date.now(); return; }
      this.agg.ingest(e);
    };
    ws.onerror = () => { /* onclose follows and handles the retry */ };
    ws.onclose = (ev) => {
      this.ws = null;
      if (ev.code === 4002) { this.health.state = "paused"; this.health.note = "Streaming bandwidth is used up. Top it up in the Solami dashboard."; return; }
      if (Date.now() - this.lastTouch < IDLE_MS) { this.health.reconnects++; this.scheduleRetry(); } else this.health.state = "idle";
    };
  }

  private scheduleRetry() {
    this.health.state = "reconnecting";
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (Date.now() - this.lastTouch < IDLE_MS) this.connect(); else this.health.state = "idle"; }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15_000);
  }

  private stop() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch { /* already closed */ } }
    this.health.state = "idle"; this.health.connectedSince = null;
  }
}

const g = globalThis as unknown as { __solamiPulseHub?: PulseHub };
/** Survives Next.js dev hot reloads, so a code edit does not leak a second socket. */
export const pulseHub = (): PulseHub => (g.__solamiPulseHub ??= new PulseHub());

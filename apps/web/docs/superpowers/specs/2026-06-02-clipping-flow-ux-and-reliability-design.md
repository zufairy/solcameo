# Clipping Flow — Reliability + Live Progress UX (design)

> **Date:** 2026-06-02 · Approved in brainstorming.
> **Goal:** Make the clipping agent actually clip (it currently refuses), and make the
> whole flow legible — premium mint moment, a one-click module gate, and realtime
> progress in both the chat and the canvas.

## Problem
1. **The agent refuses to clip.** Asked to "clip this <YouTube URL>", the chat model
   broke character ("I can't process video … fictional framework") instead of emitting
   the `clip_source` action. The builder only dispatches actions the model emits, so the
   real server pipeline (ffmpeg-static + OpenAI Whisper + Claude moment-select) never starts.
2. **Black box.** Even when a job runs, the chat shows one static "Clipping started" line
   and `ClipsQueue` only lists finished clips — the user can't see `queued → downloading →
   transcribing → analyzing → clipping → posting → completed`.
3. The mint card is a small inline card in a 22%-wide chat column — not a premium moment.

## Design

### 1. Reliable clip trigger (the core fix)
- **Prompt hardening** (`CLIPPING_SYSTEM_PROMPT`): state plainly that the agent does NOT
  process video itself — it issues a `clip_source` command to Vello's real backend pipeline
  which runs asynchronously. NEVER deny capability, never call it fictional; when given a
  video URL, emit the action.
- **Deterministic fallback** (`app/builder/page.tsx`): mirroring the existing
  `create_video`/`post_to_social` auto-injection, when `agentType === "clipping"` +
  `mintCompleted` + the user message contains an `https?://…` URL (and the model didn't
  already emit one), push `{type:"clip_source", sourceUrl}` into `aiActions`. Clipping no
  longer depends on the LLM emitting the action.

### 2. Skill gate (one-click install)
- `hasClipModule = agentType === "clipping" || installedSkills.includes("video.clip")`.
- In `executeAgentActions`' clip branch: if `!hasClipModule`, inject a `needsClipInstall`
  message (carrying the pending `sourceUrl`) instead of running. Its **Install module**
  button adds the clip skills to `installedSkills` (autosaved to Convex) and re-runs the
  clip. Clipping agents always pass the gate, so this only guides genuinely-missing agents.

### 3. Realtime progress (Convex-reactive, keyed by mintAddress)
- New `ClipJobProgress({ mintAddress, variant })` (client): `useQuery(listJobsByMint)` →
  latest active/most-recent job; renders a phase stepper from `status`
  (Download → Transcribe → Find moments → Cut(n/total) → Post / done / error) and a live
  grid of clip thumbnails from `listClipsByMint` that fill in as each renders.
  `variant: "compact"` (chat) | `"full"` (canvas).
- **Chat:** the clip dispatch adds a `clipProgress` message rendering the compact variant —
  it self-updates because it's Convex-subscribed.
- **Canvas:** `AgentWorkspace` (clipping) shows a prominent "Now clipping" full variant above
  a **restyled** `ClipsQueue` (dark/lime to match the app, was light-zinc).
- Pure helper `clipPhaseState(status)` → stepper model is unit-tested.

### 4. Premium mint overlay (all agent types)
- `MintOverlay`: a `fixed inset-0` portal with an animated blurred dark-lime gradient
  backdrop (framer-motion fade/scale; one CSS gradient-sweep keyframe). When a `needsMint`
  message exists, the `NftMintCard` renders centered+enlarged inside it instead of inline;
  a ✕ collapses to a "Ready to mint →" chip that reopens it. Mint success → existing
  celebration, overlay dismisses.

## Files
New: `components/builder/ClipJobProgress.tsx`, `components/builder/MintOverlay.tsx`.
Edit: `lib/builder/agentTypes.ts` (prompt), `app/builder/page.tsx` (inject + gate + progress
message + overlay + install handler), `components/builder/ClipsQueue.tsx` (restyle),
`components/builder/AgentWorkspace.tsx` (mount progress), `app/globals.css` (one keyframe).
No schema/query changes — statuses + `listJobsByMint`/`listClipsByMint` already exist.

## Testing
Unit: `clipPhaseState(status)` mapping, `hasClipModule()` gate, the URL-detection used by the
deterministic fallback. Reactive components + overlay verified by dev-render (thin Convex subs).

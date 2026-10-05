/**
 * ElevenLabs TEXT-TO-SPEECH (the repo already uses ElevenLabs for STT in
 * transcribe-clip — same ELEVENLABS_API_KEY). Used by the Documentary app for
 * the narrator's voiceover track.
 */

/** Curated narrator voices (public ElevenLabs premade voice ids — stable,
 *  available on every account tier). Kept small and story-appropriate. */
export const NARRATOR_VOICES = [
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel — deep documentary" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah — warm storyteller" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George — classic narrator" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte — calm, intimate" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam — energetic voiceover" },
] as const;

export const DEFAULT_NARRATOR_VOICE = NARRATOR_VOICES[0].id;

export function isKnownNarratorVoice(id: string): boolean {
  return NARRATOR_VOICES.some((voice) => voice.id === id);
}

/**
 * Synthesize `text` with the given voice; resolves to MP3 bytes.
 * eleven_multilingual_v2 handles any script language the story generator emits.
 */
export async function synthesizeVoiceover(args: {
  text: string;
  voiceId?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<Buffer> {
  const apiKey = args.apiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  const voiceId = args.voiceId && isKnownNarratorVoice(args.voiceId) ? args.voiceId : DEFAULT_NARRATOR_VOICE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: args.text,
        model_id: "eleven_multilingual_v2",
        // Tuned for documentary INTONATION: lower stability lets the voice
        // actually rise/fall with the writing instead of flat-reading it;
        // `style` pushes expressive delivery; speaker boost keeps presence.
        // Pacing itself comes from the script (punctuation + <break/> tags,
        // which multilingual_v2 honors).
        voice_settings: { stability: 0.38, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${msg.slice(0, 160)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error("ElevenLabs TTS returned no audio");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

import { readdirSync } from "node:fs";
const BASE = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/923ccbc4-975e-4368-a1cc-8e272f2cb376/scratchpad/matrix/frames";
const peak = { captions:-1.855,facetrack:-1.855,hook:-1.855,title:-1.868,keywords:-1.855,zoom:-1.855,captionstyle:-1.855,filters:-1.855,meme:-1.855,sticker:-5.898,memeaudio:-1.855,brainrot:-1.855,combo_all:-1.876 };
const expect = {
  captions:"Word-by-word captions burned in (yellow/white, near bottom), synced to speech. Vertical 9:16 reframe.",
  facetrack:"Vertical reframe keeping the SPEAKER'S FACE centered as they move, plus captions.",
  hook:"A bold HOOK TITLE text overlay (punchy headline, large text usually near top) early in the clip, plus captions.",
  title:"A bold TITLE CARD / headline overlay on the clip, plus captions.",
  zoom:"Dynamic ZOOM PUNCHES — framing scale visibly changes (zoom in/out) across frames, plus captions.",
  keywords:"Captions where KEYWORDS are emphasized (different color/size/highlight) vs normal words.",
  filters:"A VIVID color filter/grade — noticeably more saturated/punchy than neutral, plus captions.",
  captionstyle:"Captions in ALL CAPS punchy style (Smart Captions prompt asked for ALL CAPS).",
  sticker:"An emoji/STICKER graphic overlay (near top), plus captions.",
  meme:"A MEME-style caption overlay (white impact-font text, often near top), plus captions.",
  memeaudio:"A reaction SOUND EFFECT added (AUDIO-ONLY — judge by loudness peak vs plain speech ~-1.85dB; can't hear frames).",
  brainrot:"A GAMEPLAY/brain-rot BACKGROUND under the clip — split/stacked layout (talking clip on top, gameplay below), plus captions.",
  combo_all:"ALL of: vertical reframe + face-centered + hook title overlay + captions + gameplay brain-rot background together.",
};
const files = readdirSync(BASE);
const clips = Object.keys(expect).map((label) => ({ label, source:"youtube", expect:expect[label], peakDb:peak[label], nframes: files.filter((f)=>f.startsWith(label+"_f")).length }));
console.log(JSON.stringify({ base: BASE, clips }));

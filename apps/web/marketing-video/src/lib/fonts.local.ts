/**
 * fonts.ts — LOCAL brand fonts (offline render safe).
 * Loads woff2 files from public/fonts via the FontFace API.
 * Same exports as before: display / ui / mono / serif.
 */
import { continueRender, delayRender, staticFile } from "remotion";

const done = new Set<string>();
const load = (family: string, file: string, weight = "100 900", style = "normal") => {
  if (typeof document === "undefined" || done.has(family)) return family;
  done.add(family);
  const handle = delayRender(`font ${family}`, { timeout: 120000 });
  const face = new FontFace(
    family,
    `url('${staticFile(file)}') format('woff2')`,
    { weight, style } as FontFaceDescriptors,
  );
  face
    .load()
    .then((f) => {
      (document.fonts as unknown as { add: (f: FontFace) => void }).add(f);
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
  return family;
};

export const display = load("Space Grotesk", "fonts/SpaceGrotesk.woff2", "300 700");
export const ui = load("Inter", "fonts/Inter.woff2", "100 900");
export const mono = load("JetBrains Mono", "fonts/JetBrainsMono.woff2", "400 800");
export const serif = load("Newsreader", "fonts/NewsreaderItalic.woff2", "200 800");
export const geist = load("Geist", "fonts/Geist.woff2", "100 900");
export const geistMono = load("Geist Mono", "fonts/GeistMono.woff2", "100 900");

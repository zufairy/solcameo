/** Each persisted theme keeps its own visual identity in both card sizes. */
export const CALLOUT_STYLES = {
  colosseum: { family: 'CalloutCinzel, Georgia, serif', font: 'Cinzel-SemiBold.ttf', fontName: 'CalloutCinzel', weight: 600, tracking: 1.2, italic: false, radius: 16, motif: 'arches' },
  solana: { family: 'CalloutSpace, system-ui, sans-serif', font: 'SpaceGrotesk-Medium.ttf', fontName: 'CalloutSpace', weight: 500, tracking: -1, italic: false, radius: 22, motif: 'orbit' },
  lambo: { family: 'CalloutBebas, Impact, sans-serif', font: 'BebasNeue-Regular.ttf', fontName: 'CalloutBebas', weight: 400, tracking: 2, italic: false, radius: 4, motif: 'hex' },
  bullrun: { family: 'CalloutJakarta, system-ui, sans-serif', font: 'PlusJakartaSans-SemiBold.ttf', fontName: 'CalloutJakarta', weight: 600, tracking: -0.5, italic: false, radius: 8, motif: 'chart' },
  neon: { family: 'CalloutArchivo, system-ui, sans-serif', font: 'ArchivoBlack-Regular.ttf', fontName: 'CalloutArchivo', weight: 400, tracking: 0.2, italic: false, radius: 2, motif: 'grid' },
  ferrari: { family: 'CalloutBarlow, system-ui, sans-serif', font: 'Barlow-SemiBold.ttf', fontName: 'CalloutBarlow', weight: 600, tracking: 1.8, italic: true, radius: 3, motif: 'speed' },
  vault: { family: 'CalloutFraunces, Georgia, serif', font: 'Fraunces-SemiBold.ttf', fontName: 'CalloutFraunces', weight: 600, tracking: -0.5, italic: false, radius: 12, motif: 'seal' },
  pepe: { family: 'CalloutArchivo, system-ui, sans-serif', font: 'ArchivoBlack-Regular.ttf', fontName: 'CalloutArchivo', weight: 400, tracking: 0.2, italic: false, radius: 14, motif: 'grid' },
  diamond: { family: 'CalloutManrope, system-ui, sans-serif', font: 'Manrope-Medium.ttf', fontName: 'CalloutManrope', weight: 500, tracking: -1, italic: false, radius: 16, motif: 'seal' },
  aurora: { family: 'CalloutManrope, system-ui, sans-serif', font: 'Manrope-Medium.ttf', fontName: 'CalloutManrope', weight: 500, tracking: -1.5, italic: false, radius: 28, motif: 'ribbons' },
} as const;
export function calloutStyle(theme?: string) { return CALLOUT_STYLES[theme as keyof typeof CALLOUT_STYLES] ?? CALLOUT_STYLES.colosseum; }

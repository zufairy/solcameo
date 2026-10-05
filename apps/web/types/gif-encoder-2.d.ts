declare module "gif-encoder-2" {
  interface GIFOutput {
    getData(): Uint8Array;
  }
  class GIFEncoder {
    out: GIFOutput;
    constructor(width: number, height: number, algorithm?: string, useOptimizer?: boolean);
    setDelay(delay: number): void;
    setRepeat(repeat: number): void;
    setQuality(quality: number): void;
    start(): void;
    addFrame(ctx: CanvasRenderingContext2D): void;
    finish(): void;
  }
  export default GIFEncoder;
}

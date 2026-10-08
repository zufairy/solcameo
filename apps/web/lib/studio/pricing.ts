/** Create-studio image pricing. Every portrait or shirt edit costs the same, whichever engine renders it. */
export const STUDIO_IMAGE_USD = 0.1;
export const STUDIO_FREE_IMAGES = 3;
export const studioCostUsd = (images: number) => Math.round(images * STUDIO_IMAGE_USD * 100) / 100;

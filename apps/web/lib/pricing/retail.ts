/** Solcameo charges the provider's list price (Kie or Higgsfield) plus 10%. */
export const RETAIL_MARKUP = 1.1;

/** Provider price in USD to what the customer pays, rounded to a tenth of a cent. */
export function retailUsd(providerUsd: number): number {
  return Math.ceil(providerUsd * RETAIL_MARKUP * 1000 - 1e-9) / 1000;
}

/** "$0.044", "$1.98": three decimals under a dollar so tiny prices stay exact. */
export function formatRetailUsd(usd: number): string {
  const digits = usd < 1 && Math.round(usd * 100) / 100 !== usd ? 3 : 2;
  return `$${usd.toFixed(digits)}`;
}

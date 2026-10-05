/** DAMM's sqrt price expresses raw token B units per raw token A unit. */
export function marketCapSol(sqrtPrice: number, supply: number, baseDecimals: number, quoteIsTokenB: boolean) {
  const units = 10 ** (baseDecimals - 9);
  return (quoteIsTokenB ? sqrtPrice ** 2 : 1 / sqrtPrice ** 2) * units * supply;
}

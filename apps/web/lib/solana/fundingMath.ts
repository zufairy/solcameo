/**
 * Agentic funding algorithm — how much USDC to recommend topping up.
 *
 * Targets `days` of runway at the current daily burn, subtracts what's already
 * available, rounds up to the nearest $5, and floors at $10 so the suggestion is
 * always actionable. With zero burn it still suggests the $10 starter float.
 *
 * Kept web3-free so it can be unit-tested without importing the Solana SDK.
 */
export function recommendFundingUsdc(dailyBurnUsdc: number, availableUsdc: number, days = 30): number {
  const burn = Math.max(0, dailyBurnUsdc);
  const available = Math.max(0, availableUsdc);
  const needed = Math.max(0, burn * days - available);
  return Math.max(10, Math.ceil(needed / 5) * 5);
}

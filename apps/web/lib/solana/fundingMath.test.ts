import { describe, it, expect } from "vitest";
import { recommendFundingUsdc } from "./fundingMath";

describe("recommendFundingUsdc", () => {
  it("covers ~30 days of burn when the wallet is empty", () => {
    expect(recommendFundingUsdc(1, 0)).toBe(30);   // 1/day × 30 = 30
    expect(recommendFundingUsdc(2, 0)).toBe(60);
  });

  it("subtracts what's already available", () => {
    expect(recommendFundingUsdc(1, 25)).toBe(10);  // needs 5 → floored to $10
    expect(recommendFundingUsdc(1, 8)).toBe(25);   // needs 22 → rounded up to $25
  });

  it("floors at the $10 starter float (incl. zero burn / fully funded)", () => {
    expect(recommendFundingUsdc(0, 0)).toBe(10);
    expect(recommendFundingUsdc(1, 100)).toBe(10); // already over target
  });

  it("rounds up to the nearest $5", () => {
    expect(recommendFundingUsdc(0.5, 0)).toBe(15); // 15 exactly
    expect(recommendFundingUsdc(0.4, 0)).toBe(15); // 12 → 15
  });

  it("respects a custom day horizon", () => {
    expect(recommendFundingUsdc(1, 0, 7)).toBe(10); // 7 → floored to 10
    expect(recommendFundingUsdc(2, 0, 7)).toBe(15); // 14 → 15
  });

  it("treats negative inputs as zero", () => {
    expect(recommendFundingUsdc(-5, -5)).toBe(10);
  });
});

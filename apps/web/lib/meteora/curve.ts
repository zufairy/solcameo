import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigratedCollectFeeMode,
  DammV2DynamicFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenType,
  buildCurveWithMarketCap,
  buildCurveWithLiquidityWeights,
  SwapMode,
  type BuildCurveBaseParams,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ANTI_SNIPER_LEVELS, dbcOptionsSchema, type DbcOptions } from "./options";
import { CREATOR_TRADING_FEE_PERCENTAGE, TRADING_FEE_BPS } from "./feePolicy";
export function buildDbcCurve(input: DbcOptions) {
  // The trading fee is flat for every coin, whatever an older stored option says.
  const o = { ...dbcOptionsSchema.parse(input), feeBps: TRADING_FEE_BPS as number };
  const sniper = o.antiSniper ? ANTI_SNIPER_LEVELS[o.antiSniperLevel] : null;
  const base: BuildCurveBaseParams = {
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: 6,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 1000,
    },
    fee: {
      baseFeeParams: {
        // Anti-sniper: the fee decays exponentially from a high launch fee to the chosen fee, so the
        // first seconds cost the most. Without it the fee is flat.
        baseFeeMode: sniper ? BaseFeeMode.FeeSchedulerExponential : BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: sniper
          ? { startingFeeBps: sniper.startingFeeBps, endingFeeBps: o.feeBps, numberOfPeriod: sniper.numberOfPeriod, totalDuration: sniper.totalDuration }
          : { startingFeeBps: o.feeBps, endingFeeBps: o.feeBps, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: o.dynamicFee,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: o.economy === "sustainable-v1" ? CREATOR_TRADING_FEE_PERCENTAGE : 100,
      poolCreationFee: 0,
      // The creator's own first swap is not penalised by the anti-sniper fee.
      enableFirstSwapWithMinFee: !!sniper,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: o.dynamicFee ? DammV2DynamicFeeMode.Enabled : DammV2DynamicFeeMode.Disabled,
        poolFeeBps: o.feeBps,
      },
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage:
        o.economy === "sustainable-v1" ? 50 : 0,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage:
        o.economy === "sustainable-v1" ? 50 : 100,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
  };
  const caps = {
    initialMarketCap: o.initialCapSol,
    migrationMarketCap: o.graduationCapSol,
  };
  if (o.shape === "classic")
    return buildCurveWithMarketCap({ ...base, ...caps });
  const weights = Array.from({ length: 16 }, (_, i) =>
    o.shape === "steady" ? 8 + i : o.shape === "rocket" ? 16 - i : i + 1,
  );
  return buildCurveWithLiquidityWeights({
    ...base,
    ...caps,
    liquidityWeights: weights,
  });
}
/** All preview values use SDK swap math, including fees and graduation partial fills. */
export function previewDbc(input: DbcOptions) {
  // Quotes show steady-state pricing; the launch-minute anti-sniper surcharge is described separately.
  const config = buildDbcCurve({ ...input, antiSniper: false });
  const client = new DynamicBondingCurveClient(
    new Connection("https://api.devnet.solana.com"),
    "confirmed",
  );
  const raisedSol = Number(config.migrationQuoteThreshold.toString()) / 1e9;
  const quote = (sol: number) => {
    const result = client.pool.getQuoteFromInputAmount({
      config,
      swapBaseForQuote: false,
      amountIn: new BN(Math.round(sol * 1e9)),
      swapMode: SwapMode.PartialFill,
      slippageBps: 0,
    }) as unknown as { nextSqrtPrice: BN; outputAmount: BN }; // SDK IDL-derived types omit these runtime swap fields under Anchor 0.32.
    const sqrt = Number(result.nextSqrtPrice.toString()) / 2 ** 64;
    return {
      inputSol: sol,
      capSol: sqrt * sqrt * 1e6,
      tokens: Number(result.outputAmount.toString()) / 1e6,
    };
  };
  const grossSol = raisedSol / (1 - TRADING_FEE_BPS / 10000);
  const points = [
    { inputSol: 0, capSol: input.initialCapSol, tokens: 0 },
    ...Array.from({ length: 40 }, (_, i) => quote((grossSol * (i + 1)) / 40)),
  ];
  return {
    raisedSol,
    points,
    examples: [0.1, 1, 5].map(quote),
    supply: 1_000_000_000,
    lockedLiquidityPercent: 100,
    feeBps: TRADING_FEE_BPS,
  };
}

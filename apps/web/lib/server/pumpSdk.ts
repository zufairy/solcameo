// Pump 2.x's ESM bundle imports a named BN from its CommonJS Anchor dependency.
// Use the official CommonJS export for supported Node/Next interop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const { PUMP_SDK, feeSharingConfigPda, bondingCurvePda } = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");

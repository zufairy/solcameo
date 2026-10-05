import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
export async function migratedPool(connection: Connection, dbcPool: PublicKey) {
  const dbc = new DynamicBondingCurveClient(connection, "confirmed"),
    pool = await dbc.state.getPool(dbcPool);
  if (!pool?.poolState.isMigrated) return null;
  const config = await dbc.state.getPoolConfig(pool.poolState.config);
  if (!config) throw new Error("Pool config missing");
  const address = deriveDammV2PoolAddress(
    DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption],
    pool.poolState.baseMint,
    config.quoteMint,
  );
  const cp = new CpAmm(connection),
    state = await cp.fetchPoolState(address);
  if (
    ![state.tokenAMint.toBase58(), state.tokenBMint.toBase58()].includes(
      pool.poolState.baseMint.toBase58(),
    ) ||
    ![state.tokenAMint.toBase58(), state.tokenBMint.toBase58()].includes(
      NATIVE_MINT.toBase58(),
    )
  )
    throw new Error("Migrated pool mints differ");
  return {
    cp,
    address,
    state,
    baseMint: pool.poolState.baseMint,
    quoteVault: state.tokenAMint.equals(NATIVE_MINT)
      ? state.tokenAVault
      : state.tokenBVault,
  };
}
export async function migratedPosition(
  connection: Connection,
  dbcPool: PublicKey,
  owner: PublicKey,
) {
  const pool = await migratedPool(connection, dbcPool);
  if (!pool) return null;
  const positions = await pool.cp.getPositionsByUserAndTokenMint(
    owner,
    pool.baseMint,
  );
  const position = positions.find((p) => p.pool.equals(pool.address));
  if (!position) return null;
  const fees = getUnClaimLpFee(pool.state, position.positionState);
  const quoteFees = pool.state.tokenAMint.equals(NATIVE_MINT)
    ? fees.feeTokenA
    : fees.feeTokenB;
  const claim = () =>
    pool.cp.claimPositionFee2({
      owner,
      receiver: owner,
      feePayer: owner,
      position: position.position,
      positionNftAccount: position.positionNftAccount,
      pool: pool.address,
      tokenAMint: pool.state.tokenAMint,
      tokenBMint: pool.state.tokenBMint,
      tokenAVault: pool.state.tokenAVault,
      tokenBVault: pool.state.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
    });
  return { ...pool, quoteFees, claim };
}

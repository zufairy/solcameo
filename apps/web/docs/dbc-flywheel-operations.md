# DBC content flywheel operations

New sustainable-v1 launches use a fixed trading fee (default 1%). Meteora receives 20% of the fee. Creator receives 50% of the remaining fee (40% total). The partner treasury receives the other 40%; the application records half as content budget and half as platform revenue. Creator and partner each receive 50% permanently locked DAMM v2 liquidity after graduation. Existing creator-only launches keep their original configuration.

Required web environment:
- SOLCAMEO_DBC_TREASURY_SECRET: dedicated treasury keypair, JSON byte array or base58. Never NEXT_PUBLIC.
- SOLCAMEO_DBC_TREASURY_WALLET: public treasury address.
- SOLCAMEO_DBC_RPC_URL: RPC for the configured Solana network.
- INTERNAL_CRON_SECRET: same secret used by Convex and the keeper endpoint.
- KIE_API_KEY: funded provider account for paid production generation.
- SOLCAMEO_VIDEO_COST_LAMPORTS: explicit fixed service charge per accepted video generation, including provider cost and operational margin. Required before automatic mainnet generation; not a live provider quote.

Convex runs the keeper every two minutes through the configured application URL. Confirm that its application URL points to the deployed web service. Claims save signed transactions before broadcast and record verified quote-vault debits once. Budget reservation prevents concurrent double spending. Uncertain provider submissions retain the reservation for operator reconciliation rather than retrying and buying another video. A successful video becomes an episode in the application feed; social publishing requires separate connected accounts.

Devnet is an onchain test only. Test SOL never pays for KIE credits. Mainnet activation requires a separate funded treasury, funded KIE account, a deliberate service price, and the existing mainnet readiness flag. Content funds are held by the backend treasury, not a smart contract escrow. Burns are not implemented or promised. Low volume can leave a character without sufficient content budget.

Real lifecycle test on 2026-10-05:
- Mint: 3GbHX1xvnUVFnVrxLT1yNdbKy1H6yCwTBZGDLL4Tcyju
- Buy: 4h4tih3PHD2rJx8KvXG7c4HKpajZa5mG7x8fcYhvnmQstXAChjusgnkatHECxzpVAMV27MSuQg1j5HNxZ1QXJRjv
- Partner claim: 2389L66q7GBzFanWfco2Gs468kuMiYq51WARvkififdqwFmdxVPQtyLNd99tybJyWud3XNky28sBjnF3diX84eqF (970,719 lamports)
- DAMM v2 graduation: 44Ux4c9xoE6tu1U4ZmpDGkLnrgLPhFL8yp5RDw3npMdMh4WsePi1LN6x35Ce4C2RXAsefd5HudxW6QZfwmUzrsuY

Repeat with `npx tsx scripts/dbc-flywheel-smoke.ts --run` from apps/web. The script refuses mainnet and creates a small test curve, spending test SOL. Test pools are not registered as user-owned application characters.

Extended post-graduation test also passed:
- Mint: 4exsjVJyE8gFBoa5pQL8GeBUpBgTDZZyVTuyUUk1A6C8
- DAMM v2 buy: 3nazvfNkMqGJmS5vw5qhJYYddRcpRzrUdzoYDEStopWopXYTCMRK5YN7TNPjYg1FdA2qS3FqhSK2p3Xh9d9bDbdY
- LP fee claim: 4wSfziuvHeRupWvDusBujEYS1HdddAbR6FndPvEcmm5QJQxoG2CQrvrm6seesBpGf1JpkubmJDLURWEW6jxLqWgM (39,999 lamports)

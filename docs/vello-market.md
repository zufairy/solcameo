# Vello market and terminal

`/market` now uses the shadcn market table for all UI modes. It subscribes to the Convex market feed and includes search, network selection, categories, video filters, grid/table views, and a browser-local watchlist. Numeric changes flash only when the underlying market value changes; reduced-motion preferences are respected.

Market character IDs resolve to a dedicated DEX-style terminal at `/market/[id]`. Existing influencer handles and legacy mint links retain their profile routing. Character titles and descriptions are resolved server-side for metadata.

## Data and execution

- Paper-token prices, candles, ATH, rolling changes, volume, and holdings derive from Vello's executed paper trades. Candles are grouped by the selected interval; no artificial price history is generated. Charts include recorded volume, zoom/pan, and a price/market-cap switch.
- The buy/sell ticket uses the existing authenticated trade API, wallet proof, exact integer amount parsing, fee-inclusive quotes, slippage bounds, quote expiry, and idempotency keys retained across uncertain network retries. Paper trades do not submit Solana transactions.
- Holder P&L combines cash flows with the current simulated position value. It is marked using the same integer price basis as the market.
- Video counts are published platform episodes, including samples and generated content. They are not social-network post counts. The table count is bounded at 1,000 with a visible plus sign; the terminal displays the latest 100 videos.
- Market aggregation reads bounded history (5,000 trades per token). Incomplete history is displayed as unavailable. The market lists up to 100 tokens.
- Tokens with a real SPL mint can read confirmed supply and up to 20 largest token accounts through `/api/solstar/token-chain`. The server chooses the mint's network, uses configured RPC failover, and caches successful responses for 20 seconds. Token accounts are not presented as a unique holder count. RPC failures are not represented as zero supply.
- Live on-chain swap execution and on-chain candle indexing are not configured in the existing backend. The terminal makes that state explicit and disables unsupported trading.

Convex functions were deployed to production and synchronized to development. Frontend pages and API routes require the normal Next.js deployment.

Targeted tests cover ledger-derived statistics, ATH units, exact amount parsing, OHLC grouping, character routing, trading validation, and RPC behavior.

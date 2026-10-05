# Solcameo launchpad feed

Pump.fun combines a social feed, discovery, creation and trading. Solcameo applies that discovery model to AI characters: character posts and episodes lead to the character market and the DBC launch flow.

The home page has New launches, Episodes and Previews tabs. New launches only queries confirmed devnet DBC tokens through the existing `liveOnly` backend filter. Episodes limits those results to characters with published episodes. Previews explicitly labels unminted paper characters. Cards load the latest episode from the existing terminal query and real pool state from the pool API; market caps use USD estimates. Pool state refreshes every 15 seconds and after an app trade. Discovery is newest-first, not an invented trending score. The first 20 characters are shown.

Community chat/activity is a separate panel. Its historical paper ledger is marked simulated; it is not a complete stream of on-chain DBC swaps. No artificial sponsorship, burn, paid-content revenue or treasury claims are shown. Proposed fee splits and buybacks require separate implementation and economic decisions. Existing launch and swap flows still require wallet approval; this UI does not launch or spend automatically.

Verification: two component tests cover paper/live separation and the empty episode state; targeted lint passed. Local HTTPS home returned 200. Full type checking still reports existing errors outside these components. No visual browser verification or funded on-chain rehearsal was performed in this change.

Sources: https://pump.fun/ and https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/README.md

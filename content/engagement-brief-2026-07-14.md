# Engagement Brief — 2026-07-14

## Run 1 (~18:35–19:05 +08) — FIND-AND-BRIEF ONLY, nothing posted

**Mentions:** nothing new — latest is still the Jul 5 @unclebigbay143 reply. No action needed.

**Searches used:** solana builders (noisy), "building an ai agent", agent infra, clippers paid / "clipping campaign", creator payouts, solana devnet, "building in public" shipped, web3 growth distribution.

**24h guard:** no overlap with the Jul 13 brief accounts (last run was 10:10am Jul 13, >24h ago anyway).

**Competitor intel:** @Kraven_Ai announced a partnership with @Orion_Agents — "creator-driven distribution network" + decentralized agent ecosystem. Directly adjacent to Vello's positioning. Worth a read: https://x.com/Kraven_Ai/status/2076929876121305189

---

## REPLY DRAFTS (31)

### 1. Crypto Grit @CryptoGrit — Solana ecosystem news account
https://x.com/CryptoGrit/status/2076978688906739727
Post: Solana Summit Serbia Aug 26–27, free tickets, 1,100+ registered, 50+ speakers incl. banks/regulators.
> 1,100 signed up before the speaker list is even final is wild. free tickets plus regulators and banks in the same room is a rare combo. is there a builder track or mostly talks?

### 2. Uncle Samuel Sharpe @samoye95 — dev, funny take
https://x.com/samoye95/status/2076958875270410621
Post: "if you hear a 9-year-old say 'I'm building an AI agent for legal workflows', confiscate their iPad."
> the funniest part is the 9 year old probably has better eval discipline than half the yc batch. let the kid cook, but yes also touch grass

### 3. Tobi @dh_rsh — builder experimenting with Gemini agents
https://x.com/dh_rsh/status/2076894976064250173
Post: building an AI agent with Google/Gemini, finds it easier than other models.
> what's the agent doing? curious where gemini felt easier, the function calling or the long context. i found the harness matters way more than the model once you're past demo stage

### 4. Div Lohia @divlohia — commentator on AI products
https://x.com/divlohia/status/2076823249879531688
Post: Excel-agent founder unbothered by Anthropic's own Excel agent — cheaper + more accurate on one niche.
> this is the whole game imo. same base model but he wins on one narrow job he's obsessed over. depth of harness beats breadth of lab every time

### 5. Derek Rivers @DykaRivers — agent-infra builder 🎯 BETA TARGET
https://x.com/DykaRivers/status/2076777523367621036
Post: building an agent orchestration platform combining harness engineering + continuous learning.
> harness engineering plus continuous learning in one loop is ambitious, most people stop at retries and call it a day. how are you scoring outputs to feed the learning half? building agent infra myself so this one hits home

DM opener: "your orchestration loop post was solid. building vello, agents that earn usdc per verified view on solana. happy to swap agent infra notes, beta invite open if useful"

### 6. GenAI Fund @genaifund_ai — SEA AI fund
https://x.com/genaifund_ai/status/2076906902974574719
Post: Build Week Vietnam recap, Apify "Build, Deploy & Monetize AI Agents" session, 140+ attendees.
> 140+ people in the room for an agent monetization session at 9am says a lot about where SEA builder energy is right now. the build week recaps have been great

### 7. Zhu Liang @paradite_ — AI eng, eval tooling builder
https://x.com/paradite_/status/2076967864842723819
Post: bugs from model providers/routers/agent sdks make him cautious about 3rd-party deps for evals/RL.
> felt this. one buggy retry wrapper silently ate tool errors in my stack for a week and every downstream metric looked fine. for evals the only sane default is owning the thin layer yourself

### 8. Tal Weiss @majortal — 3x founder, Kychee (agent-native, run402 infra) 🎯 BETA TARGET
https://x.com/majortal/status/2076935097362620679
Post: started startup #3, bootstrapping, agent-native products, building in public.
> startup #3 and bootstrapping agent-native products is a strong combo of scar tissue and conviction. run402 as the payment rail is interesting, we went usdc rails for agent payouts and the edge cases still surprise me. what does kysigned do?

DM opener: "fellow agent-payments builder here, we went usdc on solana for per-view agent payouts. would love to swap notes on run402 vs raw rails sometime"

### 9. Anurag Verma @anurag_629 — dev, framework watcher
https://x.com/anurag_629/status/2076932232153895175
Post: every serious agent framework = Rust sandboxing underneath, TS orchestration on top.
> the split makes sense, the sandbox needs determinism and the orchestration needs iteration speed. same reason payout logic lives in one strict service while everything around it stays loose in my stack

### 10. Hearth & Code @HearthandCode — indie dev
https://x.com/HearthandCode/status/2076945202959249453
Post: paranoid about agents wrecking local infra/knowledge vault, sometimes yolos it and prays.
> the yolo-and-pray stage is real. what finally helped me was giving the agent a devnet-style sandbox where the worst case is disposable. blast radius design beats better prompts

### 11. Shorya Mishra @SMishra61 — dev
https://x.com/SMishra61/status/2076966587761062249
Post: 150+ PRs + production fixes > another "I'm building agents" announcement; infra layer is where agents break.
> agreed, streaming, retries and state are where agent systems quietly rot. 150 merged prs in that layer is a hire signal not a follow signal

### 12. Dhruv Jain @kubectl_yml — fintech SDE2
https://x.com/kubectl_yml/status/2076954407493935320
Post: built UK open banking payment gateway (Barclays/HSBC/Lloyds), shipped AI scrum master agent solo.
> shipping an open banking gateway across three uk banks and a solo ai scrum master on the side is a wild range. iso 20022 messaging alone is a rite of passage. what's next for the agent?

### 13. drew @drewwall_ — clipping campaign operator 🎯 BETA TARGET (top pick)
https://x.com/drewwall_/status/2076883412648853840
Post: offering 0-fee clipping campaigns for Streamer U attendees, refunds unused budget.
> 0 fee and refunding unused budget is exactly the trust move most clipping middlemen skip. how are you verifying views before payout? that's the part that broke every campaign i've watched

DM opener: "saw you're running 0-fee clipping campaigns for streamer u. building vello, verified per-view usdc payouts for clippers on solana. want early access to run campaigns on it?"

### 14. Saint @0xSaint_ — clipping/growth operator 🎯 BETA TARGET
https://x.com/0xSaint_/status/2076689408623820980
Post: clipping campaigns without conversion tracking waste money; ROI is the only metric.
> this. views without conversion tracking is just paying for a vanity chart. we ended up building verified per-view payouts because founders kept getting burned by exactly this. what do you use for attribution rn?

DM opener: "your clipping ROI take was spot on. building vello, pay per verified view in usdc. would love your eyes on the attribution side as an early user"

### 15. Trenches @playTrenches — game running live clipping campaign 🎯 BETA TARGET
https://x.com/playTrenches/status/2076732602929565763
Post: considering a leaderboard for their clipping campaign, asking the community.
> leaderboards work but they concentrate rewards on the top 5 and the middle of the pack churns. tiered brackets or streak bonuses keep clippers around way longer. what's your acceptance rate looking like?

DM opener: "saw the trenches clipping campaign and the leaderboard question. building vello for exactly this workflow, verified views + automatic usdc payouts. want a beta slot for your next campaign?"

### 16. R2D2 @R2D2zen — buys clipping campaigns 🎯 BETA TARGET
https://x.com/R2D2zen/status/2076549122396676466
Post: needed a clipping campaign, provider that replied in minutes won the business.
> speed to first reply is the whole sales funnel in clipping rn, the market is that young. also says demand is outpacing the number of serious operators

DM opener: "you mentioned sourcing a clipping campaign last week. building vello, bounty campaigns where you only pay per verified view. keen to show you before your next run?"

### 17. Yuva @yuvadfy — growth/clipping commentator
https://x.com/yuvadfy/status/2076683068623208650
Post: politicians should run clipping campaigns; tens of thousands of clippers > press office.
> the snowball clip doing numbers organically is proof the raw material is there. clipping works when the moments are real and falls flat when it's manufactured. politicians might be the final boss of that rule

### 18. Ian @fischerville — X commentator
https://x.com/fischerville/status/2076949962739319035
Post: every X tweak is a patch to a feature they broke; biggest one is creator payouts.
> creator payouts is the one where the incentive design was broken on day one. paying for engagement without verifying quality gets you exactly the reply-guy economy we got

### 19. Oles Filonenko @FilonenkoOles — writer covering X payout cuts
https://x.com/FilonenkoOles/status/2076938076530598145
Post: thread arguing X slashed creator payouts after hitting Premium sub targets.
> the deeper problem is creators can't audit any of it. the platform decides the number and you take it or leave it. that opacity is why i think verifiable per-view payouts end up winning

### 20. Dr Prteek @DrHomeostatic — commentator
https://x.com/DrHomeostatic/status/2076942103679287718
Post: YouTube ahead of X in creator payouts — watch time, CPMs, audience breadth.
> youtube's real moat is trust, creators can forecast income there. x payouts swing wildly and nobody can plan a business on that. payout predictability beats payout size

### 21. QBitFlow @QBitFlowApp — payments startup
https://x.com/QBitFlowApp/status/2076930159949550046
Post: launch thread, referral program, "refer a friend tired of frozen payouts."
> frozen payouts as the wedge is smart, that pain is universal for creators and merchants. curious what your settlement rail is underneath

### 22. Omerta @theomertadotfun — game founder, devnet live 🎯 BETA TARGET
https://x.com/theomertadotfun/status/2076901374734881187
Post: "we building. mafia sim on solana. devnet is live. you want in?"
> a mafia sim is such a good fit for onchain, betrayal with actual stakes. what's on devnet so far, the economy loop or just combat? shipping playable before mainnet is the right order

DM opener: "mafia sim on devnet looks fun. games are the best fit for clipper campaigns, on vello clippers get paid per verified view. want beta access when you push toward mainnet?"

### 23. R3TR0sync @R3TR0sync — music platform founder on Solana 🎯 BETA TARGET
https://x.com/R3TR0sync/status/2076760675628843247
Post: 3 months building music platform for independent artists, devnet, first end-to-end on-chain purchase landed; asks ownership vs discovery vs artist support.
> first end-to-end purchase on devnet is the milestone that actually matters, everything before that is slides. on your question, ownership brings the artists but discovery keeps them. distribution is the hard part

DM opener: "your ownership vs discovery question is exactly why we built vello, distribution as payable work per verified view. beta is open for founders, want a look?"

### 24. Gabe @gabe_onchain — solo non-dev, hackathon builder 🎯 BETA TARGET
https://x.com/gabe_onchain/status/2076741752816271783
Post: non-developer built Pari-Market, a prediction market on Solana devnet, for the SuperteamEarn World Cup hackathon.
> a non-dev shipping a working prediction market on devnet would've been science fiction two years ago. huge respect for entering the arena. what stack got you there?

DM opener: "pari-market is sick for a first solana build. running vello beta for builders who need distribution, clipper agents that earn per verified view. want in?"

### 25. Dan @danik1900 — hackathon dev, trustless settlement 🎯 BETA TARGET
https://x.com/danik1900/status/2076741068033528145
Post: SnapTap — World Cup prediction markets settling trustlessly on-chain, proofs against TxODDS merkle roots.
> settling against an onchain merkle root instead of a trusted oracle is the right kind of stubborn. verified data beats promised data in anything with money attached. how heavy is the proof on compute?

DM opener: "your merkle-proof settlement is the same philosophy behind verified views on vello. building on solana too, would love to trade notes, beta invite open"

### 26. Percolator @PercolatorTrade — perp DEX building in public
https://x.com/PercolatorTrade/status/2076808049419788714
Post: spun up a devnet perp market in under 40 seconds, testing with co-founders and beta users.
> spinning up a market in 40 seconds is a real infra flex. devnet testing in public like this is underrated marketing too, people trust what they can watch

### 27. erik faz jurgensen @erikfazj — ecosystem tool builder
https://x.com/erikfazj/status/2076896824980296077
Post: shipped v1 of ansemtracker.com — atlas of ecosystem projects, stats, directory + submissions next.
> an ecosystem atlas with submissions is the kind of unglamorous tool that ends up load-bearing. directory next is right, discovery is always the bottleneck

### 28. Mehran @AetherMaker — indie builder
https://x.com/AetherMaker/status/2076784695572848941
Post: getting copied when building in public is proof you're onto something; they copy what you shipped, not how you think.
> copies get the blueprint but not the roadmap. by the time they ship your v1 you're on v3. distribution and taste don't fork

### 29. Bishwas Jha @Normal_Bishwas — indie dev, day 8 building in public
https://x.com/Normal_Bishwas/status/2076752657520419003
Post: day 8 — patched bugs, merged contributor PR, shipped releases; 7 contributors.
> day 8 and already merging outside contributions is the hard part done, most building in public never gets a second contributor. what's the tool do?

### 30. SASAM @onadeonft — web3 growth commentator
https://x.com/onadeonft/status/2076927205343723572
Post: web3's real challenge isn't innovation, it's how projects reach the right users.
> this is the realest problem in web3. tech is abundant, distribution is scarce. it's why i'm building payout rails for the people who do the distributing, the reach layer needs its own economy

### 31. Artu Grande @ArtuGrande — tech creator, personal brand article
https://x.com/ArtuGrande/status/2076774444052127875
Post: X article "Your personal brand is a story: what you share, what you build. Just show up." (3.6K views)
> the just show up part is underrated. posting the boring middle of building beats announcing the polished end every time

---

## QUOTE-POST DRAFTS (10)

### Q1. @TechFollowrazzi — Shortcut AI beat the Excel world champion 3-1
https://x.com/TechFollowrazzi/status/2076860738639946046
> an agent beating the excel world champion 3-1 is the most 2026 sentence ever. niche agents with obsessive harnesses are quietly lapping the general ones

### Q2. @AgenticSummit — marco de rossi: brain (model), body (harness), world (infra)
https://x.com/AgenticSummit/status/2076951620412383638
> brain, body, world is the cleanest framing of agent infra i've seen. everyone's racing on brains. the money is in bodies and worlds

### Q3. @danik1900 — trustless settlement vs trusted oracles
https://x.com/danik1900/status/2076741068033528145
> this is what verified actually means. proven against an onchain merkle root, not "trust our dashboard". same energy we chase with verified views. receipts or it didn't happen

### Q4. @gabe_onchain — solo non-dev shipped a prediction market
https://x.com/gabe_onchain/status/2076741752816271783
> a solo non-developer shipped a working prediction market on solana devnet. the builder pool just got 100x bigger and most people haven't noticed yet

### Q5. @divlohia — excel agent founder vs anthropic
https://x.com/divlohia/status/2076823249879531688
> the moat isn't the model, it's the thousand paper cuts you fixed in one narrow job. every agent founder should read this

### Q6. @0xSaint_ — clipping ROI
https://x.com/0xSaint_/status/2076689408623820980
> views are an input, conversions are the output. clipping campaigns that don't verify and attribute are just expensive confetti

### Q7. @FilonenkoOles — X payout cuts thread
https://x.com/FilonenkoOles/status/2076938069249286220
> whatever you think of the specifics, the lesson holds. if a platform can silently cut your payout, you don't have an income, you have an allowance

### Q8. @samoye95 — 9yo agent builder joke
https://x.com/samoye95/status/2076958875270410621
> confiscating the ipad won't stop the agent economy lol. the on-ramp age just keeps dropping

### Q9. @R3TR0sync — 3 months quiet building, first onchain purchase
https://x.com/R3TR0sync/status/2076760675628843247
> three months of quiet building, then one real onchain purchase. that's a better launch announcement than most token generation events

### Q10. @yuvadfy — politicians should run clipping campaigns
https://x.com/yuvadfy/status/2076683068623208650
> clipping is eating political comms too. tens of thousands of clippers beat one press office. distribution is the new airtime

---

## REPOST PICKS (10)

1. https://x.com/CryptoGrit/status/2076978688906739727 — Solana Summit Serbia details (useful to builder audience)
2. https://x.com/genaifund_ai/status/2076906902974574719 — SEA Build Week agent-monetization recap
3. https://x.com/AgenticSummit/status/2076951620412383638 — brain/body/world agent framing
4. https://x.com/anurag_629/status/2076932232153895175 — Rust+TS agent framework pattern
5. https://x.com/paradite_/status/2076967864842723819 — 3rd-party agent sdk bug caution
6. https://x.com/majortal/status/2076935097362620679 — Kychee agent-native building in public
7. https://x.com/AetherMaker/status/2076784695572848941 — copied = validation take
8. https://x.com/ArtuGrande/status/2076774444052127875 — personal brand article
9. https://x.com/PercolatorTrade/status/2076808049419788714 — devnet perp testing in public
10. https://x.com/erikfazj/status/2076896824980296077 — ansemtracker v1 ship

## LIKE SUGGESTIONS
All reply targets above, plus: @HearthandCode (agent paranoia), @kubectl_yml (fintech+agent), @dh_rsh (gemini agent), @Normal_Bishwas (day 8), @fischerville (payouts take), @SMishra61 (infra PRs).

---

## BETA TARGETS SUMMARY (10 flagged)
| Handle | Why | Priority |
|---|---|---|
| @drewwall_ | runs clipping campaigns with real budgets, trust-first positioning | 🔥 top |
| @playTrenches | live clipping campaign right now, iterating on incentives | 🔥 top |
| @R2D2zen | actively BUYS clipping campaigns, values responsiveness | 🔥 top |
| @0xSaint_ | preaches ROI/verification for clipping, exact Vello thesis | high |
| @danik1900 | verification-native solana dev (merkle-proof settlement) | high |
| @theomertadotfun | game founder pre-mainnet, needs distribution | high |
| @R3TR0sync | music platform founder, distribution is his open question | high |
| @gabe_onchain | new solana builder via SuperteamEarn hackathon | med |
| @majortal | agent-payments founder (run402), peer swap-notes | med |
| @DykaRivers | agent orchestration builder | med |

**Vello mention count in reply drafts:** 5/31 (16%) — within the ≤25% rule.

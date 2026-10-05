# Vello

## Live Solana research with Solami and x402

Vello agents can purchase evidence-backed token reports through x402 v2, then use live Solami mainnet activity in their research. External agents can access the same paid API. Open `/intelligence` in the app for the owner-facing demo.

See the [runnable integration guide](docs/integrations/x402-solami.md) for environment setup, spending wallets, API access, recovery, tests, and the Solami bounty demo checklist.

Vello is an AI sales-and-service assistant system, extracted from the jobtepi
monorepo into its own repository. It is two cooperating apps that share the
jobtepi Supabase database as their data backend.

```
vello/
├── apps/
│   ├── web/      Next.js + Convex + Solana/Anchor frontend + app server
│   └── worker/   Fastify AI worker runtime (autonomy loop, channels, skills)
├── package.json  npm-workspaces root
└── README.md
```

## Apps

### `apps/web` — Vello web app
Next.js 14 app (App Router) with a Convex backend, Solana/Anchor programs, and
a marketing-video pipeline. Talks to Supabase for auth and shared data.

```bash
cd apps/web
npm install
npm run dev
```

### `apps/worker` — Vello worker runtime
Fastify service that runs Vello's autonomy loop, conversation engine
(Anthropic), memory layer (Supabase), and channel/commerce skills.

```bash
cd apps/worker
npm install
cp .env.example .env   # fill in SUPABASE_* and ANTHROPIC_API_KEY at minimum
npm run dev            # tsx watch, port 4200
```

## Data backend: jobtepi Supabase

Vello does **not** run its own primary database. Both apps read and write the
**jobtepi Supabase project** (`https://slmlubxaclmoqxivcurz.supabase.co`)
directly:

- **`apps/web`** uses the public **anon key** in the browser (gated by Row Level
  Security) and the **service role key** server-side. `lib/supabase.ts` ships
  the jobtepi URL + anon key as defaults, so the web app works out of the box;
  env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) override them per deployment.
- **`apps/worker`** uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to read
  and write the `vello_clients`, `vello_conversations`, and `vello_memory`
  tables.

There is no REST API layer between Vello and jobtepi — Supabase (with RLS + the
service role key) **is** the shared API. The relevant tables are owned by the
jobtepi migrations (e.g. `..._create_vello_memory_layer.sql`).

> Schema changes to the `vello_*` tables still live in the jobtepi repo's
> `supabase/migrations/`. Coordinate migrations there.

## Environment

Each app keeps its own env file (`.env.local` / `.env`). They are gitignored;
see `apps/worker/.env.example` and `apps/web/.env.example` for the keys.

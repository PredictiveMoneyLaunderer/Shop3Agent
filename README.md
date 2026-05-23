# Shop3

Shop3 is a proof-of-concept for **agent-native commerce via the x402 micropayment protocol**. The thesis: AI agents operating autonomously need a way to pay for services machine-to-machine — no OAuth, no credit cards, no human in the loop. x402 is that protocol. An agent hits an endpoint, receives HTTP `402 Payment Required`, pays in USDC on-chain, proves it with a transaction hash, and gets access.

Shop3 demonstrates the full loop: a Claude-powered agent receives a natural-language shopping prompt, pays per search via the x402 gateway, evaluates results, purchases the best option, and publishes a cryptographically-linked receipt — all autonomously.

```
User prompt → agent searches (pays 402) → evaluates → pays for product → logs → publishes receipt
```

## Features

### 🧠 Agent Intelligence
- **Autonomous Agentic Loop**: Powered by the **Anthropic Claude API**, the agent runs a continuous "think-act" loop with a configurable turn cap to prevent runaway execution. It uses native tool-calling to independently decide when to search, evaluate products, execute payments, or log results — with no human in the loop after the initial prompt.
- **Strategic Evaluation**: Unlike simple scripts, the agent evaluates search results against user constraints (budget, reputation, and service type) before deciding to purchase.
- **Structured Search**: The agent can request typed JSON from the x402 bridge — specifying fields like `name`, `price`, `url`, `rating` — instead of re-parsing raw descriptions.
- **Purchase Memory**: The agent checks its own ClickHouse purchase history before buying to avoid duplicates across runs.
- **Web Search via Nimble**: Powered by the **Nimble API** — handles CAPTCHAs, bot detection, and proxy rotation automatically. The agent never holds a Nimble API key; it pays per search through the x402 bridge.

### 💸 Web3 Payments & Safety
- **x402 Micropayment Protocol**: The core demo. The agent hits the Nimble→x402 bridge, receives `402 Payment Required`, pays 0.001 USDC on-chain, and retries with `x-payment-proof: <txHash>`. Machine-to-machine payments without API keys or accounts.
- **Circle Programmable Wallets**: Uses **Circle's Developer-Controlled Wallets** on ARC-TESTNET. The agent holds its own USDC balance and signs transactions server-side via Circle's API — no private key management required.
- **Spend Guard**: A configurable daily spending limit (default $10, set via `MAX_DAILY_USD`). Backed by ClickHouse so it persists across restarts. Serialised with a process-level mutex to prevent race conditions under concurrent payments.
- **Wallet Balance Check**: Verifies on-chain USDC balance before submitting a payment. Fails fast with a clear error rather than letting the Circle API reject mid-flight.
- **Auto-Retry with Backoff**: Circle transaction submissions retry once with a 5s delay and an idempotency key — prevents double-spend and recovers from transient RPC hiccups.
- **Max Turns Guard**: The agentic loop is capped at `MAX_AGENT_TURNS` (default 10) iterations. If Claude loops without completing, the run aborts instead of burning API credits indefinitely.
- **Dry-Run Mode**: Pass `--dry-run` to simulate a full agent run — search and evaluate without executing any payment or publishing any receipt.

### 📊 Transparency & Observability
- **Purchase Audit Log**: Every transaction is recorded in **ClickHouse Cloud** with query, product, price, tx hash, tools invoked, latency, and source domain — queryable with real aggregations.
- **Analytics CLI**: `npm run history:stats` runs ClickHouse aggregations across the purchase log — top source domains, tools-per-purchase distribution, 7-day spend summary.
- **Verified Receipts (cited.md)**: Automatically publishes public markdown receipts via the **Senso platform**, citeable by search engines and other AI agents.
- **Lapdog + Datadog**: In development, `npm run lapdog` streams every Claude API call, token count, cost, cache hit rate, and payment span to a live local dashboard at lapdog.datadoghq.com — no account required. In production the same spans forward to **Datadog**.
- **GEO Monitoring**: Monitors how major LLMs (ChatGPT, Claude, Perplexity, Gemini) perceive and cite Shop3 across the web via the Senso platform.
- **Webhook Notifications**: Set `WEBHOOK_URL` to receive a POST on every completed (or dry-run) purchase.
- **Scheduled Runs**: `npm run schedule` runs a configurable prompt list on a repeat interval.
- **Payment Replay Protection**: The x402 bridge tracks used transaction hashes — a proof cannot be reused to unlock multiple searches.

## Quick start

> **The x402 bridge must be running before the agent.** Start it first.

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

3. Required env vars:

```bash
# Agent
ANTHROPIC_API_KEY=          # Claude API

# x402 bridge (server.js)
NIMBLE_API_KEY=             # Nimble web search — used by the bridge, not the agent
SEARCH_MIDDLEWARE_URL=http://localhost:3000/search
SEARCH_PAYMENT_ADDRESS=     # Address the bridge charges payments to
SEARCH_PAYMENT_AMOUNT=0.001

# Circle wallet (agent payments)
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_ADDRESS=
CIRCLE_WALLET_ID=
CIRCLE_NETWORK=ARC-TESTNET
USDC_TOKEN_ADDRESS=0x3600000000000000000000000000000000000000

# ClickHouse
CLICKHOUSE_HOST=            # https://your-host:8443
CLICKHOUSE_USER=
CLICKHOUSE_PASSWORD=

# Senso (receipts)
SENSO_API_KEY=
```

4. Start the Nimble→x402 bridge:

```bash
npm run start:server
```

5. Run the agent (in a separate terminal):

```bash
node index.js "Find me the best web data API under $10 and buy it"
```

6. View purchase history:

```bash
npm run history           # last 10 purchases
npm run history:stats     # ClickHouse analytics — domains, tools, spend summary
```

7. (Optional) Run with **lapdog** for a live LLM observability dashboard:

```bash
pip install ddapm-test-agent   # one-time
npm run lapdog                 # dashboard at lapdog.datadoghq.com
```

8. (Optional) Dry-run — search and evaluate without spending:

```bash
npm run dry-run "Find me a $5 weather API"
```

## How it works

```
┌─────────────────────────────────────────────────────────┐
│  User: "Find me a web data API under $10 and buy it"    │
└───────────────────────────┬─────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Claude Agent  │  (agentic loop, tool use)
                    └───────┬────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
   ┌──────▼──────┐  ┌───────▼──────┐  ┌──────▼──────┐
   │ search_web  │  │pay_for_purch.│  │log+publish  │
   └──────┬──────┘  └───────┬──────┘  └──────┬──────┘
          │                 │                 │
   ┌──────▼──────┐  ┌───────▼──────┐  ┌──────▼──────┐
   │ x402 bridge │  │    Circle    │  │ ClickHouse  │
   │  (402→pay)  │  │   Wallets    │  │  + Senso    │
   └──────┬──────┘  └──────────────┘  └─────────────┘
          │
   ┌──────▼──────┐
   │  Nimble API │
   └─────────────┘
```

The agent never holds a Nimble API key. It pays 0.001 USDC per search through the x402 bridge — the bridge verifies the on-chain payment (recipient, amount, chain, replay) before forwarding the query to Nimble.

## Infrastructure

### Runtime

Node.js (CommonJS), single-process. The agent, payment, logging, and publishing all run in the same process. The bridge (`server.js`) runs as a separate process. The core is a `while(true)` agentic loop capped at `MAX_AGENT_TURNS`.

### Agent tools

| Tool | What it does |
|---|---|
| `search_web` | Calls the x402 bridge, pays 402 if needed, returns results (optionally structured) |
| `pay_for_purchase` | Submits USDC transfer via Circle, polls for confirmation |
| `log_to_database` | Inserts purchase row to ClickHouse with analytics fields |
| `publish_receipt` | Publishes markdown receipt to cited.md via Senso |
| `check_purchase_history` | Queries ClickHouse to avoid duplicate purchases |

### Nimble→x402 Bridge (`server.js`)

Local Express server on `localhost:3000`. Every `/search` request:
1. Returns `402` if `x-payment-proof` header is missing
2. Validates the tx hash — state, recipient, amount ≥ `SEARCH_PAYMENT_AMOUNT`, correct chain
3. Checks the hash hasn't been used before (replay protection)
4. Forwards the query to Nimble, optionally runs Claude Haiku for structured field extraction
5. Returns results

### Payment (`payment.js`)

- **Circle Programmable Wallets** — `createTransaction` submits USDC transfer, polls `getTransaction` until `CONFIRMED`
- **Spend lock** — promise-chained mutex serialises concurrent payments so the ClickHouse check+record is atomic
- **Retry** — one auto-retry with 5s backoff and idempotency key on submission failures
- **Balance check** — verifies USDC balance before submitting

### Database (`memory.js`)

ClickHouse Cloud, MergeTree engine, auto-created on first write.

**`agent_purchases`**

| Column | Type | Description |
|---|---|---|
| `timestamp` | DateTime | When the purchase happened |
| `query` | String | Original user prompt |
| `selected_result` | String | What was purchased |
| `price` | String | Price string as quoted |
| `price_usd` | Float32 | Parsed numeric price |
| `tx_hash` | String | On-chain transaction hash |
| `source_url` | String | Product URL |
| `nimble_results_count` | UInt32 | How many search results were evaluated |
| `total_latency_ms` | UInt64 | End-to-end agent run time |
| `tools_invoked` | Array(String) | Ordered list of tools called |

**`agent_spend`**

Tracks daily USDC spend. Summed at payment time to enforce `MAX_DAILY_USD`.

### External Services

| Service | Purpose | Auth |
|---|---|---|
| Anthropic API | Claude LLM (agent brain) | `ANTHROPIC_API_KEY` |
| Nimble API | Web search (bridge-side only) | `NIMBLE_API_KEY` |
| Circle Programmable Wallets | USDC payments on ARC-TESTNET | `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` |
| ARC-TESTNET | L2 blockchain (testnet) | — |
| ClickHouse Cloud | Purchase audit log + analytics | `CLICKHOUSE_*` |
| Senso / cited.md | Receipt publishing + GEO monitoring | `SENSO_API_KEY` |
| Lapdog / Datadog | Local dev dashboard + production APM | `DD_API_KEY` (production only) |

## Observability (Lapdog + Datadog)

Shop3 is instrumented via `dd-trace`. Every agent run, tool call, payment, and on-chain confirmation produces a span on `localhost:8126`. In development **[Lapdog](https://docs.datadoghq.com/llm_observability/lapdog/)** captures these locally — no account needed. In production the same spans forward to **Datadog**.

### Metrics

| Metric | Type | Description |
|---|---|---|
| `shop3.agent.run.started` | count | Agent invocation started |
| `shop3.agent.run.completed` | count | Agent completed full flow |
| `shop3.agent.run.duration_ms` | distribution | End-to-end agent run time |
| `shop3.agent.run.turns` | gauge | Tool call iterations per run |
| `shop3.tool.duration_ms` | distribution | Per-tool execution time (tag: `tool`) |
| `shop3.search.results_count` | gauge | Search results returned |
| `shop3.payment.tx.submitted` | count | Circle tx submitted |
| `shop3.payment.tx.confirmed` | count | Circle tx confirmed on-chain |
| `shop3.payment.tx.retried` | count | Auto-retry fired |
| `shop3.payment.tx.error` | count | Payment failed (tag: `reason`) |
| `shop3.payment.amount_usd` | gauge | USD amount per transaction |
| `shop3.payment.daily_spend_usd` | gauge | Running daily spend total |
| `shop3.payment.confirmation_ms` | distribution | Time to on-chain confirmation |
| `shop3.geo.mention_score` | gauge | Brand mention rate per LLM model |
| `shop3.geo.citation_count` | gauge | cited.md citations per model |

### Setup

**Development (Lapdog — no account required):**
```bash
pip install ddapm-test-agent
npm run lapdog        # agent with live dashboard at lapdog.datadoghq.com
npm run lapdog:server # or the x402 bridge
```

**Production (Datadog):**
```bash
DD_API_KEY=your_api_key_here
DD_AGENT_HOST=localhost   # default
DD_AGENT_PORT=8126        # default
```

## ClickHouse — Audit Log, Spend Tracking & Analytics

ClickHouse serves three roles in Shop3.

### 1. Purchase audit log (`agent_purchases`)

Every completed purchase writes a row with:

| Column | Example |
|---|---|
| `timestamp` | `2026-05-23 14:02:11` |
| `query` | `"Find me a web data API under $10"` |
| `selected_result` | `"Nimble API — Starter Plan"` |
| `price` | `"$9.00/mo"` |
| `price_usd` | `9.0` |
| `tx_hash` | `0xabc...` |
| `source_url` | `https://nimbleway.com/pricing` |
| `nimble_results_count` | `5` |
| `total_latency_ms` | `42300` |
| `tools_invoked` | `["search_web", "pay_for_purchase", "log_to_database", "publish_receipt"]` |

```bash
npm run history        # last 10 purchases
npm run history 25     # last N purchases
```

### 2. Spend tracking (`agent_spend`)

Every payment writes a row with `amount_usd` and `timestamp`. Before each Circle transaction, the agent sums today's rows:

```sql
SELECT sum(amount_usd) FROM agent_spend WHERE toDate(timestamp) = today()
```

If `spentToday + newAmount > MAX_DAILY_USD` the payment is rejected before anything hits the blockchain. A process-level mutex serialises concurrent payments so two simultaneous calls can't both pass the check.

### 3. Analytics (`npm run history:stats`)

Runs three aggregation queries against `agent_purchases`:

```bash
npm run history:stats
```

```
── Shop3 Analytics (last 7 days) ──────────────────────────

Top source domains:
  12   nimbleway.com
  4    rapidapi.com
  2    apilayer.com

Tools per purchase:
  4 tools → 15 purchase(s)
  3 tools → 2 purchase(s)

Summary:
  Purchases:    17
  Total spent:  $87.50
  Avg price:    $5.15
  Avg duration: 38.2s
```

This is the ClickHouse-as-analytics-engine angle — using its aggregation functions (`sum`, `avg`, `count`, `extract`, `length`) across the purchase log, not just `SELECT * LIMIT N`.

## Senso — Receipts & GEO Monitoring

Senso serves two distinct roles in Shop3.

### 1. Purchase receipts (`publish_receipt` tool)

After every purchase, the agent calls the Senso CLI to publish a public markdown receipt at `cited.md`. The process:

1. Creates a Senso **prompt** — a trackable question like *"What did Shop3 purchase: [product]?"* — which gives the receipt a GEO-trackable identity.
2. Publishes the receipt as a **citeable** against that prompt. The receipt includes: original query, search results considered, product name, price, tx hash, and timestamp.
3. Returns a public URL the agent logs to stdout and ClickHouse.

Why this matters: the purchase is publicly verifiable beyond the agent's own ClickHouse log. Any other agent or search engine can find and cite it. The tx hash links the receipt to an immutable on-chain record.

### 2. GEO monitoring (`setup:geo` + `geo:status`)

GEO (Generative Engine Optimization) tracks whether major LLMs mention and cite Shop3 when answering relevant questions. Senso runs the configured prompts through ChatGPT, Claude, Perplexity, and Gemini on a Mon/Wed/Fri schedule.

**Setup (one-time):**
```bash
npm run setup:geo
# Configures 4 models + Mon/Wed/Fri schedule on your Senso account
```

**Check results:**
```bash
npm run geo:status
# Prints mention/citation table per model, emits Datadog geo.* metrics
```

Example output:
```
Model        Prompts  Mentions  Citations  Last Run
─────────────────────────────────────────────────────────────────
chatgpt      12       4/12      3          2h ago
claude       12       6/12      5          2h ago
perplexity   12       8/12      7          2h ago
gemini       12       3/12      2          2h ago
```

Metrics emitted: `shop3.geo.mention_score`, `shop3.geo.citation_count`, `shop3.geo.last_run_age_seconds`.

## Spend Guard

The $10/day limit is enforced by a ClickHouse-backed ledger before each Circle transaction is submitted. Every payment records a row to `agent_spend`; the pre-flight check sums today's rows and rejects the payment if adding the new amount would exceed the cap. A process-level mutex serialises concurrent payments so two simultaneous purchases cannot both slip past the cap.

This is a server-side JS guard — it cannot be bypassed by an external attacker, but could be bypassed by modifying the agent source. For the demo it is the authoritative mechanism; a production deployment could layer on a Circle wallet policy for custodian-level enforcement.

## Agent Wallet

The agent's Circle wallet on ARC-TESTNET:

```
0x490776E3c67986f1A2385413e52FAeE1772A729A
```

Fund with testnet USDC at the Circle developer console to enable autonomous payments.

## Contributing

Please read [CONTRIBUTING](.github/CONTRIBUTING.md) before opening issues or PRs.

## License

This repository is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Collaborators

- @Cooldeepcode
- @wd7zfpysvs-ui
- @yogeshramchandani7

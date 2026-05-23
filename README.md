# Shop3

An autonomous Web3 shopping agent. Give it a prompt, it searches the web, picks the best result, pays for it on-chain with USDC, logs the purchase to a database, and publishes a verified receipt — no human in the loop after the initial prompt.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your secrets:

```bash
cp .env.example .env
```

3. Make sure the following env vars are set in `.env`:

```bash
ANTHROPIC_API_KEY=        # Claude API key (required — nothing runs without this)
NIMBLE_API_KEY=           # Web search
WALLET_PRIVATE_KEY=       # Ethereum private key for the agent smart wallet
ZERODEV_PROJECT_ID=391415d7-7b73-4531-ba86-94268ecedfef
ZERODEV_RPC_URL=https://rpc.zerodev.app/api/v3/391415d7-7b73-4531-ba86-94268ecedfef/chain/84532
CLICKHOUSE_HOST=          # ClickHouse Cloud host (https://...:8443)
CLICKHOUSE_USER=          # ClickHouse user
CLICKHOUSE_PASSWORD=      # ClickHouse password
SENSO_API_KEY=            # Senso / cited.md receipt publishing
DD_API_KEY=               # Datadog APM (optional)
```

4. Run the agent:

```bash
node index.js "Find me the best web data API under $10 and buy it"
```

5. View purchase history:

```bash
node history.js       # last 10 purchases
node history.js 25    # last N purchases
```

6. (Optional) Run the local search middleware (x402 payment-gated search):

```bash
npm run start:server
```

## Infrastructure

### Runtime

Node.js (CommonJS), single-process. The agent, payment, search, logging, and publishing all run in the same process — no queue, no workers. The core is a `while(true)` agentic loop that calls Claude until the task is complete.

### Agentic Loop

**Anthropic Claude API** (`@anthropic-ai/sdk`)
- Model: `claude-sonnet-4-6`
- Native tool use — Claude decides which tool to call and when
- Loop sends full message history each turn, receives either a tool call or a final response
- 4 tools: `search_web`, `pay_for_purchase`, `log_to_database`, `publish_receipt`

### Search

**Nimble API**
- `POST https://sdk.nimbleway.com/v1/search`
- Returns titles, URLs, descriptions for a query
- Auth: `Authorization: Bearer <NIMBLE_API_KEY>`

**x402 middleware** (optional, `server.js`)
- Local Express server on `localhost:3000`
- Gates search results behind HTTP 402 Payment Required
- Agent pays in USDC on-chain, retries with `x-payment-proof: <txHash>` header
- Demonstrates machine-to-machine micropayments via the x402 protocol

### Payment

**ZeroDev SDK** (`@zerodev/sdk`)
- ERC-4337 smart wallet (Kernel account) derived from `WALLET_PRIVATE_KEY`
- Bundler: ZeroDev RPC (`ZERODEV_RPC_URL`) on Base Sepolia (chain 84532)

**viem**
- Encodes ERC-20 `transfer(address, uint256)` calldata
- Converts USD amounts to USDC's 6-decimal raw integer
- Waits for on-chain transaction receipt

**USDC on Base Sepolia**
- Contract: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Direct ERC-20 transfer — no DEX, no swap

**Spend guard**
- $10/day in-memory limit, checked before every payment
- Resets at midnight (note: resets on process restart in current implementation)

### Database

**ClickHouse Cloud** (`@clickhouse/client`)
- Table: `agent_purchases` (auto-created on first write, MergeTree engine)
- Schema: `timestamp, query, selected_result, price, tx_hash, source_url`
- Operations: `INSERT` on purchase, `SELECT ... LIMIT N` for history viewer

### Receipt Publishing

**Senso / cited.md** (`SENSO_API_KEY`)
- Publishes a markdown receipt as a public citeable at `cited.md/shop3/<slug>`
- Receipt includes: query, search results considered, product, price, tx hash, BaseScan link

### External Services

| Service | Purpose | Auth |
|---|---|---|
| Anthropic API | Claude LLM (agent brain) | `ANTHROPIC_API_KEY` |
| Nimble API | Web search | `NIMBLE_API_KEY` |
| ZeroDev RPC | Smart wallet / tx bundler | `ZERODEV_PROJECT_ID` + `ZERODEV_RPC_URL` |
| Base Sepolia | L2 blockchain (testnet) | `WALLET_PRIVATE_KEY` |
| USDC contract | Payment token | on-chain |
| ClickHouse Cloud | Purchase audit log | `CLICKHOUSE_*` |
| Senso / cited.md | Receipt publishing | `SENSO_API_KEY` |
| Datadog | APM + metrics | `DD_API_KEY` |

## Observability (Datadog)

Shop3 is instrumented with [Datadog APM](https://www.datadoghq.com/) via `dd-trace`. All agent runs, tool calls, payments, and on-chain confirmations are traced automatically.

### Metrics

| Metric | Type | Description |
|---|---|---|
| `shop3.agent.run.started` | count | Agent invocation started |
| `shop3.agent.run.completed` | count | Agent completed full flow |
| `shop3.agent.run.duration_ms` | distribution | End-to-end agent run time |
| `shop3.tool.duration_ms` | distribution | Per-tool execution time (tag: `tool`) |
| `shop3.search.results_count` | gauge | Number of search results returned |
| `shop3.payment.tx.submitted` | count | On-chain tx submitted (tags: `token`, `chain`) |
| `shop3.payment.tx.confirmed` | count | On-chain tx confirmed |
| `shop3.payment.tx.error` | count | Payment failed (tag: `reason`) |
| `shop3.payment.amount_usd` | gauge | USD amount paid per transaction |
| `shop3.payment.daily_spend_usd` | gauge | Running daily spend total |
| `shop3.payment.confirmation_ms` | distribution | Time to on-chain confirmation |

APM traces cover the full `search → pay → log → publish` flow with child spans per tool call.

### Setup

1. Install the Datadog Agent: https://docs.datadoghq.com/agent/
2. Add to `.env`:

```bash
DD_API_KEY=your_api_key_here
DD_AGENT_HOST=localhost   # default
DD_AGENT_PORT=8126        # default
```

## Agent Wallet

The agent's smart wallet address on Base Sepolia:

```
0x490776E3c67986f1A2385413e52FAeE1772A729A
```

Fund it with testnet USDC to enable autonomous payments.

## Contributing

Please read [CONTRIBUTING](.github/CONTRIBUTING.md) before opening issues or PRs.

## License

This repository is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Collaborators

- @Cooldeepcode
- @wd7zfpysvs-ui
- @yogeshramchandani7

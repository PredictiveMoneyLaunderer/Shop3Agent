# Shop3

Shop3 — Node.js project (agent.js, index.js, memory.js, payment.js, publish.js, search.js)

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your secrets:

```bash
cp .env.example .env
```

3. Make sure the following Zerodev payment gateway values are set in `.env`:

```bash
ZERODEV_PROJECT_ID=391415d7-7b73-4531-ba86-94268ecedfef
ZERODEV_RPC_URL=https://rpc.zerodev.app/api/v3/391415d7-7b73-4531-ba86-94268ecedfef/chain/84532
```

This project now uses the ZeroDev SDK `createKernelAccountClient` smart wallet flow on Base Sepolia, so payments are executed through your ZeroDev project RPC endpoint.

4. (Optional) Run the local search middleware:

```bash
npm run start:server
```

5. Run the app:

```bash
node index.js
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

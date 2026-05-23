require('dotenv').config();
process.env.SERVER_MODE = 'true';

const express = require('express');
const { createPublicClient, http } = require('viem');
const { baseSepolia } = require('viem/chains');
const { searchWeb } = require('./search');

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

const app = express();
const PORT = parseInt(process.env.SERVER_PORT, 10) || 3000;
const PAYMENT_PAYTO = process.env.SEARCH_PAYMENT_ADDRESS || '0x1111111111111111111111111111111111111111';
const PAYMENT_PRICE = process.env.SEARCH_PAYMENT_AMOUNT || '0.001';
const PAYMENT_TOKEN = process.env.SEARCH_PAYMENT_TOKEN || 'USDC';
const PAYMENT_CHAIN = process.env.SEARCH_PAYMENT_CHAIN || 'base-sepolia';

function isValidTxHash(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

app.get('/', (req, res) => {
  res.json({ message: 'Search middleware running', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'query parameter is required' });
  }

  const paymentProof = req.header('x-payment-proof');
  if (!paymentProof) {
    return res.status(402).json({
      price: `${PAYMENT_PRICE} ${PAYMENT_TOKEN}`,
      payTo: PAYMENT_PAYTO,
      reason: 'Pay to search the web',
      chain: PAYMENT_CHAIN,
      token: PAYMENT_TOKEN,
    });
  }

  if (!isValidTxHash(paymentProof)) {
    return res.status(402).json({
      error: 'Invalid payment proof',
      required_payment: {
        price: `${PAYMENT_PRICE} ${PAYMENT_TOKEN}`,
        payTo: PAYMENT_PAYTO,
        reason: 'Pay to search the web',
        chain: PAYMENT_CHAIN,
        token: PAYMENT_TOKEN,
      },
    });
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: paymentProof });
    if (!receipt || receipt.status !== 'success') {
      return res.status(402).json({ error: 'Payment transaction not confirmed on-chain' });
    }
  } catch {
    return res.status(402).json({ error: 'Could not verify payment transaction on-chain' });
  }

  try {
    const numResults = Number(req.query.num_results) || 5;
    const results = await searchWeb(query, numResults);
    return res.json({ results });
  } catch (err) {
    console.error('[server] Search failed:', err);
    return res.status(500).json({ error: err.message || 'Search failed' });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Search middleware running at http://localhost:${PORT}`);
  console.log(`[server] Payment handler expects x-payment-proof header and returns 402 if missing.`);
});

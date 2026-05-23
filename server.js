require('dotenv').config();

const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const app = express();
const PORT = parseInt(process.env.SERVER_PORT, 10) || 3000;
const PAYMENT_PAYTO = process.env.SEARCH_PAYMENT_ADDRESS || '0x1111111111111111111111111111111111111111';
const PAYMENT_PRICE = process.env.SEARCH_PAYMENT_AMOUNT || '0.001';
const PAYMENT_TOKEN = process.env.SEARCH_PAYMENT_TOKEN || 'USDC';
const PAYMENT_CHAIN = process.env.SEARCH_PAYMENT_CHAIN || 'ARC-TESTNET';

const ALLOWED_SCHEMA_FIELDS = new Set(['name', 'price', 'url', 'rating', 'vendor', 'description']);

// In-memory replay guard — resets on server restart, sufficient for testnet/dev use
const usedTxHashes = new Set();

function isValidTxHash(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function nimbleSearch(query, numResults = 5) {
  const apiKey = process.env.NIMBLE_API_KEY;
  if (!apiKey) throw new Error('NIMBLE_API_KEY not set');

  const response = await axios.post(
    'https://sdk.nimbleway.com/v1/search',
    { query, max_results: numResults },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return (response.data?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

// Verify a Circle tx: state, recipient, amount, chain — returns { ok, reason }
async function verifyCirclePayment(txHash) {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });
  const res = await client.listTransactions({ txHash });
  const tx = res.data?.transactions?.[0];

  if (!tx) return { ok: false, reason: 'tx_not_found' };
  if (tx.state !== 'CONFIRMED' && tx.state !== 'COMPLETE') return { ok: false, reason: 'not_confirmed' };
  if (tx.destinationAddress?.toLowerCase() !== PAYMENT_PAYTO.toLowerCase()) {
    return { ok: false, reason: 'wrong_recipient' };
  }
  const paid = parseFloat(tx.amounts?.[0] ?? '0');
  if (paid < parseFloat(PAYMENT_PRICE)) {
    return { ok: false, reason: 'amount_too_low', paid, required: PAYMENT_PRICE };
  }
  if (tx.blockchain && tx.blockchain !== PAYMENT_CHAIN) {
    return { ok: false, reason: 'wrong_chain' };
  }
  return { ok: true };
}

function validateSchema(schemaStr) {
  let parsed;
  try {
    parsed = JSON.parse(schemaStr);
  } catch {
    return { valid: false, error: 'schema must be valid JSON' };
  }
  if (!Array.isArray(parsed?.fields)) {
    return { valid: false, error: 'schema.fields must be an array of strings' };
  }
  const invalid = parsed.fields.filter((f) => !ALLOWED_SCHEMA_FIELDS.has(f));
  if (invalid.length > 0) {
    return { valid: false, error: `unknown fields: ${invalid.join(', ')}. Allowed: ${[...ALLOWED_SCHEMA_FIELDS].join(', ')}` };
  }
  return { valid: true, fields: parsed.fields };
}

async function extractWithSchema(results, fields) {
  const client = new Anthropic();
  const prompt = `Extract the following fields from each search result. Return only a JSON array with one object per result, in the same order. If a field cannot be determined, use null.

Fields to extract: ${fields.join(', ')}

Search results:
${JSON.stringify(results.map((r) => ({ title: r.title, url: r.url, description: r.description })), null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.content[0]?.text ?? '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const extracted = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return extracted.map((item, i) => {
      const safe = {};
      for (const f of fields) safe[f] = item[f] ?? null;
      safe.url = results[i]?.url; // always preserve original URL
      return safe;
    });
  } catch {
    return results.map((r) => {
      const obj = { url: r.url, unparseable: true };
      for (const f of fields) obj[f] = null;
      return obj;
    });
  }
}

app.get('/', (req, res) => {
  res.json({ message: 'Shop3 Nimble→x402 bridge running', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'query parameter is required' });
  }

  // Parse and validate optional schema
  let schemaFields = null;
  if (req.query.schema) {
    const { valid, fields, error } = validateSchema(req.query.schema);
    if (!valid) return res.status(400).json({ error: `Invalid schema: ${error}` });
    schemaFields = fields;
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
    return res.status(402).json({ error: 'Invalid payment proof format' });
  }

  if (usedTxHashes.has(paymentProof)) {
    return res.status(402).json({ error: 'Payment proof already used' });
  }

  const verification = await verifyCirclePayment(paymentProof).catch((err) => ({
    ok: false, reason: 'verification_error', detail: err.message,
  }));

  if (!verification.ok) {
    return res.status(402).json({ error: 'Payment verification failed', reason: verification.reason });
  }

  usedTxHashes.add(paymentProof);

  try {
    const numResults = Number(req.query.num_results) || 5;
    let results = await nimbleSearch(query, numResults);

    if (schemaFields) {
      results = await extractWithSchema(results, schemaFields);
    }

    return res.json({ results });
  } catch (err) {
    console.error('[server] Search failed:', err);
    return res.status(500).json({ error: err.message || 'Search failed' });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Shop3 Nimble→x402 bridge running at http://localhost:${PORT}`);
  console.log(`[server] Agent pays ${PAYMENT_PRICE} ${PAYMENT_TOKEN} per search → verified on-chain before results are returned`);
});

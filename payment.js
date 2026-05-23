const { randomUUID } = require('crypto');
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { isAddress } = require('viem');
const axios = require('axios');
const { withSpan, increment, gauge, timing } = require('./telemetry');
const { getSpendToday, recordSpend } = require('./memory');

const MAX_DAILY_USD = parseFloat(process.env.MAX_DAILY_USD) || 10;

function getCircleClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey) throw new Error('CIRCLE_API_KEY not set');
  if (!entitySecret) throw new Error('CIRCLE_ENTITY_SECRET not set');
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

async function getWalletAddress() {
  const addr = process.env.CIRCLE_WALLET_ADDRESS;
  if (!addr) throw new Error('CIRCLE_WALLET_ADDRESS not set');
  return addr;
}

async function getWalletStatus() {
  const address = process.env.CIRCLE_WALLET_ADDRESS;
  const network = process.env.CIRCLE_NETWORK || 'ARC-TESTNET';
  const dailyCapUsd = MAX_DAILY_USD;
  let balanceUsdc = null;
  let spentTodayUsd = 0;

  try {
    const client = getCircleClient();
    const res = await client.listWalletTokenBalances({ walletId: process.env.CIRCLE_WALLET_ID });
    const balances = res.data?.tokenBalances ?? [];
    const usdc = balances.find(
      (b) => b.token?.symbol === 'USDC' ||
        b.token?.tokenAddress?.toLowerCase() === process.env.USDC_TOKEN_ADDRESS?.toLowerCase()
    );
    balanceUsdc = parseFloat(usdc?.amount ?? '0');
  } catch {
    // non-fatal — banner still prints with 'unavailable'
  }

  try {
    spentTodayUsd = await getSpendToday();
  } catch {
    // non-fatal
  }

  return { address, network, balanceUsdc, spentTodayUsd, dailyCapUsd };
}

async function checkSpendLimit(amountUSD) {
  if (isNaN(amountUSD) || amountUSD <= 0) {
    throw new Error(`Invalid payment amount: ${amountUSD}`);
  }
  const spentToday = await getSpendToday();
  if (spentToday + amountUSD > MAX_DAILY_USD) {
    throw new Error(`Daily spend limit of $${MAX_DAILY_USD} would be exceeded (used: $${spentToday.toFixed(2)})`);
  }
}

async function checkWalletBalance(client, amountUSD) {
  try {
    const res = await client.listWalletTokenBalances({ walletId: process.env.CIRCLE_WALLET_ID });
    const balances = res.data?.tokenBalances ?? [];
    const usdc = balances.find(
      (b) => b.token?.symbol === 'USDC' ||
        b.token?.tokenAddress?.toLowerCase() === process.env.USDC_TOKEN_ADDRESS?.toLowerCase()
    );
    const available = parseFloat(usdc?.amount ?? '0');
    console.log(`[payment] Wallet USDC balance: $${available.toFixed(2)}`);
    if (available < amountUSD) {
      throw new Error(`Insufficient USDC balance: $${available.toFixed(2)} available, $${amountUSD} required`);
    }
  } catch (err) {
    if (err.message.startsWith('Insufficient')) throw err;
    console.warn(`[payment] Could not verify wallet balance (proceeding): ${err.message}`);
  }
}

function isNonRetryable(err) {
  const msg = (err?.message ?? '').toUpperCase();
  return msg.includes('INSUFFICIENT_FUNDS') || msg.includes('POLICY_DENIED') ||
    msg.includes('DENIED') || msg.includes('CANCELLED');
}

async function retryWithBackoff(fn, { attempts = 2, delayMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < attempts - 1 && !isNonRetryable(err)) {
        console.log(`[payment] Attempt ${i + 1} failed: ${err.message}. Retrying in ${delayMs / 1000}s...`);
        increment('payment.tx.retried', { attempt: String(i + 1) });
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

// Poll Circle until the transaction reaches a terminal state, return blockchain txHash
async function waitForCircleTx(client, txId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    const state = tx?.state;
    if (state === 'CONFIRMED' || state === 'COMPLETE') {
      return tx.txHash;
    }
    if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') {
      throw new Error(`Circle transaction ${txId} ended with state: ${state}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Circle transaction ${txId} timed out after ${timeoutMs}ms`);
}

async function handle402Payment(paymentInfo) {
  const { payTo, amount, token, chain } = paymentInfo;

  if (!isAddress(payTo)) {
    throw new Error(`Invalid payTo address: ${payTo}`);
  }

  console.log(`[payment] 402 received — paying ${amount} ${token} to ${payTo} on ${chain}`);

  const amountUSD = parseFloat(amount);
  await checkSpendLimit(amountUSD);

  return withSpan('payment.transaction', { token, chain, 'payment.amount_usd': amountUSD }, async (span) => {
    const client = getCircleClient();
    await checkWalletBalance(client, amountUSD);

    const idempotencyKey = randomUUID();
    let txId;

    try {
      txId = await retryWithBackoff(async () => {
        const res = await client.createTransaction({
          walletId: process.env.CIRCLE_WALLET_ID,
          blockchain: process.env.CIRCLE_NETWORK || 'ARC-TESTNET',
          destinationAddress: payTo,
          amounts: [amount.toString()],
          tokenAddress: process.env.USDC_TOKEN_ADDRESS,
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
          idempotencyKey,
        });
        const id = res.data?.id;
        if (!id) throw new Error('Circle did not return a transaction ID');
        return id;
      });
      span.setTag('payment.circle_tx_id', txId);
      increment('payment.tx.submitted', { token, chain });
      console.log(`[payment] Circle tx submitted: ${txId}`);
    } catch (err) {
      span.setTag('payment.status', 'submit_failed');
      span.setTag('error', true);
      increment('payment.tx.error', { token, chain, reason: 'submit_failed' });
      throw err;
    }

    console.log('[payment] Waiting for on-chain confirmation...');
    const confirmStart = Date.now();
    let txHash;
    try {
      txHash = await waitForCircleTx(client, txId);
      const confirmMs = Date.now() - confirmStart;
      await recordSpend(amountUSD);
      const spentToday = await getSpendToday();
      span.setTag('payment.status', 'confirmed');
      span.setTag('payment.confirmation_ms', confirmMs);
      span.setTag('payment.tx_hash', txHash);
      span.setTag('payment.daily_spend_usd', spentToday);
      timing('payment.confirmation_ms', confirmMs, { token, chain });
      gauge('payment.amount_usd', amountUSD, { token, chain });
      gauge('payment.daily_spend_usd', spentToday);
      increment('payment.tx.confirmed', { token, chain });
      console.log(`[payment] Confirmed: ${txHash}`);
    } catch (err) {
      span.setTag('payment.status', 'confirmation_failed');
      span.setTag('error', true);
      increment('payment.tx.error', { token, chain, reason: 'confirmation_failed' });
      throw err;
    }

    return txHash;
  });
}

async function fetchWithPayment(url, headers = {}) {
  try {
    const response = await axios.get(url, { headers });
    return { data: response.data, txHash: null };
  } catch (err) {
    if (err.response?.status === 402) {
      const paymentInfo = err.response.data;
      console.log('[payment] Got 402 Payment Required:', paymentInfo);
      const txHash = await handle402Payment(paymentInfo);
      const retryResponse = await axios.get(url, {
        headers: { ...headers, 'x-payment-proof': txHash },
      });
      return { data: retryResponse.data, txHash };
    }
    throw err;
  }
}

async function mockPaymentFlow(selectedResult, price) {
  console.log(`[payment] Simulating 402 payment for: ${selectedResult}`);

  const rawAmount = parseFloat(price.replace(/[^0-9.]/g, ''));
  const amount = (!isNaN(rawAmount) && rawAmount > 0) ? rawAmount.toFixed(2) : '1.00';

  const mockPaymentInfo = {
    payTo: '0x7dc1517b622edc0d945978312a5496ed6784ee51',
    amount,
    token: 'USDC',
    chain: process.env.CIRCLE_NETWORK || 'ARC-TESTNET',
  };

  return handle402Payment(mockPaymentInfo);
}

module.exports = { fetchWithPayment, mockPaymentFlow, getWalletAddress, getWalletStatus, handle402Payment };

const { createPublicClient, http, parseUnits, encodeFunctionData, isAddress } = require('viem');
const { baseSepolia } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { createKernelAccountClient } = require('@zerodev/sdk');
const axios = require('axios');
const { withSpan, increment, gauge, timing } = require('./telemetry');
const { getSpendToday, recordSpend } = require('./memory');

// Minimal ERC-20 transfer ABI
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

// USDC on Base Sepolia (Circle's testnet deployment)
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const MAX_DAILY_USD = 10;

async function checkSpendLimit(amountUSD) {
  if (isNaN(amountUSD) || amountUSD <= 0) {
    throw new Error(`Invalid payment amount: ${amountUSD}`);
  }
  const spentToday = await getSpendToday();
  if (spentToday + amountUSD > MAX_DAILY_USD) {
    throw new Error(`Daily spend limit of $${MAX_DAILY_USD} would be exceeded (used: $${spentToday.toFixed(2)})`);
  }
}

function getWalletClient() {
  const ZERODEV_PROJECT_ID = process.env.ZERODEV_PROJECT_ID;
  const ZERODEV_RPC_URL = process.env.ZERODEV_RPC_URL;

  if (!ZERODEV_PROJECT_ID) {
    throw new Error('ZERODEV_PROJECT_ID is not set. Add it to your .env file.');
  }
  if (!ZERODEV_RPC_URL) {
    throw new Error('ZERODEV_RPC_URL is not set. Add it to your .env file.');
  }

  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY not set');

  const account = privateKeyToAccount(
    privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
  );

  const rpcUrl = ZERODEV_RPC_URL.trim();
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport,
  });

  const walletClient = createKernelAccountClient({
    account,
    chain: baseSepolia,
    client: publicClient,
    bundlerTransport: transport,
  });

  return { account, walletClient, publicClient };
}

async function getWalletAddress() {
  const { account } = getWalletClient();
  return account.address;
}

// Handle a 402 Payment Required response and pay
async function handle402Payment(paymentInfo) {
  const { payTo, amount, token, chain } = paymentInfo;

  if (!isAddress(payTo)) {
    throw new Error(`Invalid payTo address: ${payTo}`);
  }

  console.log(`[payment] 402 received — paying ${amount} ${token} to ${payTo} on ${chain}`);

  const amountUSD = parseFloat(amount);
  await checkSpendLimit(amountUSD);

  return withSpan('payment.transaction', { token, chain, amount }, async () => {
    const { account, walletClient, publicClient } = getWalletClient();

    const amountRaw = parseUnits(amount.toString(), 6);

    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [payTo, amountRaw],
    });

    let txHash;
    try {
      txHash = await walletClient.sendTransaction({
        account,
        to: USDC_ADDRESS,
        data,
        chain: baseSepolia,
      });
      increment('payment.tx.submitted', { token, chain });
    } catch (err) {
      increment('payment.tx.error', { token, chain, reason: 'submit_failed' });
      throw err;
    }

    console.log(`[payment] Tx submitted: ${txHash}`);
    console.log('[payment] Waiting for confirmation...');

    const confirmStart = Date.now();
    try {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      const confirmMs = Date.now() - confirmStart;
      await recordSpend(amountUSD);
      const spentToday = await getSpendToday();
      timing('payment.confirmation_ms', confirmMs, { token, chain });
      gauge('payment.amount_usd', amountUSD, { token, chain });
      gauge('payment.daily_spend_usd', spentToday);
      increment('payment.tx.confirmed', { token, chain });
    } catch (err) {
      increment('payment.tx.error', { token, chain, reason: 'confirmation_failed' });
      throw err;
    }

    console.log(`[payment] Confirmed: ${txHash}`);
    return txHash;
  });
}

// Simulate hitting a 402 endpoint (for demo — real x402 endpoints return this in headers/body)
async function fetchWithPayment(url, headers = {}) {
  try {
    const response = await axios.get(url, { headers });
    return { data: response.data, txHash: null };
  } catch (err) {
    if (err.response?.status === 402) {
      const paymentInfo = err.response.data;
      console.log('[payment] Got 402 Payment Required:', paymentInfo);

      const txHash = await handle402Payment(paymentInfo);

      // Retry with payment proof
      const retryResponse = await axios.get(url, {
        headers: { ...headers, 'x-payment-proof': txHash },
      });

      return { data: retryResponse.data, txHash };
    }
    throw err;
  }
}

// Mock a 402 flow for demo when no real paywall endpoint is available
async function mockPaymentFlow(selectedResult, price) {
  console.log(`[payment] Simulating 402 payment for: ${selectedResult}`);

  const rawAmount = parseFloat(price.replace(/[^0-9.]/g, ''));
  const amount = (!isNaN(rawAmount) && rawAmount > 0) ? rawAmount.toFixed(2) : '1.00';

  const mockPaymentInfo = {
    payTo: '0x742d35Cc6634C0532925a3b8D4C9C2b5b2B2b2b2',
    amount,
    token: 'USDC',
    chain: 'base-sepolia',
  };

  const txHash = await handle402Payment(mockPaymentInfo);
  return txHash;
}

module.exports = { fetchWithPayment, mockPaymentFlow, getWalletAddress, handle402Payment };

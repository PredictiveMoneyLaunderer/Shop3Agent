const { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData } = require('viem');
const { baseSepolia } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const axios = require('axios');

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

// Daily spend guard (in-memory for demo — production would use on-chain policy)
const spendTracker = { date: null, total: 0 };
const MAX_DAILY_USD = 10;

function checkSpendLimit(amountUSD) {
  const today = new Date().toISOString().slice(0, 10);
  if (spendTracker.date !== today) {
    spendTracker.date = today;
    spendTracker.total = 0;
  }
  if (spendTracker.total + amountUSD > MAX_DAILY_USD) {
    throw new Error(`Daily spend limit of $${MAX_DAILY_USD} would be exceeded (used: $${spendTracker.total})`);
  }
  spendTracker.total += amountUSD;
}

function getWalletClient() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY not set');

  const account = privateKeyToAccount(
    privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
  );

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
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

  console.log(`[payment] 402 received — paying ${amount} ${token} to ${payTo} on ${chain}`);

  const amountUSD = parseFloat(amount);
  checkSpendLimit(amountUSD);

  const { account, walletClient, publicClient } = getWalletClient();

  // For USDC (6 decimals)
  const amountRaw = parseUnits(amount.toString(), 6);

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [payTo, amountRaw],
  });

  const txHash = await walletClient.sendTransaction({
    account,
    to: USDC_ADDRESS,
    data,
    chain: baseSepolia,
  });

  console.log(`[payment] Tx submitted: ${txHash}`);
  console.log('[payment] Waiting for confirmation...');

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log(`[payment] Confirmed: ${txHash}`);
  return txHash;
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

  const mockPaymentInfo = {
    payTo: '0x742d35Cc6634C0532925a3b8D4C9C2b5b2B2b2b2',
    amount: price.replace('$', '').replace('/mo', '').trim() || '1.00',
    token: 'USDC',
    chain: 'base-sepolia',
  };

  const txHash = await handle402Payment(mockPaymentInfo);
  return txHash;
}

module.exports = { fetchWithPayment, mockPaymentFlow, getWalletAddress, handle402Payment };

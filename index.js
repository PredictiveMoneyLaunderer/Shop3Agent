require('dotenv').config();

const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY',
  'NIMBLE_API_KEY',
  'WALLET_PRIVATE_KEY',
  'ZERODEV_PROJECT_ID',
  'ZERODEV_RPC_URL',
  'CLICKHOUSE_HOST',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_PASSWORD',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const { runAgent } = require('./agent');

const prompt = process.argv.slice(2).join(' ') || 'Find me the best web data API subscription under $10 and buy it';

console.log('='.repeat(60));
console.log('  Valution Agent — Autonomous Web3 Shopping');
console.log('='.repeat(60));
console.log(`\nPrompt: "${prompt}"\n`);

runAgent(prompt)
  .then((result) => {
    console.log('\n' + '='.repeat(60));
    if (result.receiptUrl) {
      console.log(`\nReceipt: ${result.receiptUrl}`);
    }
    if (result.txHash) {
      console.log(`Tx:      https://sepolia.basescan.org/tx/${result.txHash}`);
    }
    console.log('='.repeat(60));
  })
  .catch((err) => {
    console.error('\n[fatal]', err.message);
    process.exit(1);
  });

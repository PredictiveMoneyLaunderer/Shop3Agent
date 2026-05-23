require('dotenv').config();

const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY',
  'SEARCH_MIDDLEWARE_URL',   // agent always routes through the x402 bridge
  'CIRCLE_API_KEY',
  'CIRCLE_ENTITY_SECRET',
  'CIRCLE_WALLET_ADDRESS',
  'CIRCLE_WALLET_ID',
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const promptArgs = args.filter((a) => a !== '--dry-run');
const prompt = promptArgs.join(' ') || 'Find me the best web data API subscription under $10 and buy it';

console.log('='.repeat(60));
console.log('  Shop3 — Autonomous Web3 Shopping Agent');
console.log('='.repeat(60));
if (dryRun) console.log('  [DRY RUN MODE]');
console.log(`\nPrompt: "${prompt}"\n`);

runAgent(prompt, { dryRun })
  .then((result) => {
    console.log('\n' + '='.repeat(60));
    if (result.receiptUrl) console.log(`Receipt: ${result.receiptUrl}`);
    if (result.txHash)     console.log(`Tx:      ${result.txHash}`);
    console.log('='.repeat(60));
  })
  .catch((err) => {
    console.error('\n[fatal]', err.message);
    process.exit(1);
  });

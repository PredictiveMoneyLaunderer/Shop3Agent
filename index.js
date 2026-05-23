require('dotenv').config();
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

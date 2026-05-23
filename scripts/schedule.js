require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { runAgent } = require('../agent');

const PROMPTS = (() => {
  try {
    return JSON.parse(process.env.SCHEDULED_PROMPTS || '[]');
  } catch {
    return [];
  }
})();

const INTERVAL_HOURS = parseFloat(process.env.SCHEDULE_INTERVAL_HOURS) || 24;
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

if (PROMPTS.length === 0) {
  console.error('[schedule] No prompts found. Set SCHEDULED_PROMPTS in .env as a JSON array of strings.');
  console.error('  Example: SCHEDULED_PROMPTS=["Find me the best web data API under $10 and buy it"]');
  process.exit(1);
}

console.log(`[schedule] Running ${PROMPTS.length} prompt(s) every ${INTERVAL_HOURS}h`);
PROMPTS.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

async function runAll() {
  const ts = new Date().toISOString();
  console.log(`\n[schedule] Firing at ${ts}`);
  for (const prompt of PROMPTS) {
    try {
      console.log(`\n[schedule] → "${prompt}"`);
      await runAgent(prompt);
    } catch (err) {
      console.error(`[schedule] Run failed for prompt "${prompt}": ${err.message}`);
    }
  }
}

// Run immediately, then on interval
runAll().then(() => {
  setInterval(runAll, INTERVAL_MS);
}).catch((err) => {
  console.error('[schedule] Fatal error on first run:', err.message);
  process.exit(1);
});

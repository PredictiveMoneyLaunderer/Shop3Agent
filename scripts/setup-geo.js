require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { senso, sensoVoid } = require('./senso-run');

const MODELS = ['chatgpt', 'claude', 'perplexity', 'gemini'];
const SCHEDULE = [1, 3, 5]; // Mon, Wed, Fri

async function main() {
  console.log('[geo:setup] Configuring GEO monitoring for Shop3...\n');

  console.log(`[geo:setup] Setting models: ${MODELS.join(', ')}`);
  sensoVoid('run-config set-models', ['--data', JSON.stringify({ models: MODELS })]);

  console.log(`[geo:setup] Setting schedule: Mon/Wed/Fri (days ${SCHEDULE.join(',')})`);
  sensoVoid('run-config set-schedule', ['--data', JSON.stringify({ schedule: SCHEDULE })]);

  // Verify models
  const modelsResult = senso('run-config models');
  const configuredModels = (modelsResult.models ?? []).map((m) => m.name);
  const missingModels = MODELS.filter((m) => !configuredModels.includes(m));
  if (missingModels.length > 0) {
    throw new Error(`Model config verification failed — missing: ${missingModels.join(', ')}`);
  }
  console.log(`[geo:setup] ✓ Models verified: ${configuredModels.join(', ')}`);

  // Verify schedule
  const scheduleResult = senso('run-config schedule');
  const configuredSchedule = scheduleResult.schedule ?? [];
  const missingDays = SCHEDULE.filter((d) => !configuredSchedule.includes(d));
  if (missingDays.length > 0) {
    throw new Error(`Schedule verification failed — missing days: ${missingDays.join(', ')}`);
  }
  console.log(`[geo:setup] ✓ Schedule verified: days ${configuredSchedule.join(',')}`);

  console.log('\n[geo:setup] Done. GEO monitoring will run Mon/Wed/Fri across ChatGPT, Claude, Perplexity, and Gemini.');
  console.log('[geo:setup] First results appear at https://geo.senso.ai within 24-48 hours of the next run.');
}

main().catch((err) => {
  console.error('[geo:setup] Failed:', err.message);
  process.exit(1);
});

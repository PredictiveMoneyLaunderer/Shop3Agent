require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { senso } = require('./senso-run');
const { gauge, increment } = require('../telemetry');

async function main() {
  console.log('[geo:status] Fetching GEO monitoring results for Shop3...\n');

  const { prompts = [] } = senso('prompts list');

  if (prompts.length === 0) {
    console.log('[geo:status] No prompts found. Run the Senso onboarding skill to create tracking questions.');
    console.log('[geo:status] Emitting sentinel metrics (last_run_age_seconds = -1).');
    for (const model of ['chatgpt', 'claude', 'perplexity', 'gemini']) {
      gauge('geo.last_run_age_seconds', -1, { model });
    }
    return;
  }

  console.log(`[geo:status] Found ${prompts.length} prompt(s). Fetching run history...\n`);

  const modelStats = {};

  for (const prompt of prompts) {
    let detail;
    try {
      detail = senso('prompts get', [prompt.id ?? prompt.prompt_id]);
    } catch {
      continue;
    }

    const runs = detail?.prompt?.runs ?? detail?.runs ?? [];
    for (const run of runs) {
      const results = run.results ?? [];
      const runAt = new Date(run.run_at ?? run.created_at ?? 0);

      for (const result of results) {
        const model = result.model ?? 'unknown';
        if (!modelStats[model]) {
          modelStats[model] = { mentions: 0, citations: 0, prompts: 0, lastRunAt: null };
        }
        modelStats[model].prompts += 1;
        if (result.brand_mentioned) modelStats[model].mentions += 1;
        const citedMdLinks = (result.citations ?? []).filter(
          (c) => typeof c === 'string' && c.includes('cited.md')
        );
        modelStats[model].citations += citedMdLinks.length;
        if (!modelStats[model].lastRunAt || runAt > modelStats[model].lastRunAt) {
          modelStats[model].lastRunAt = runAt;
        }
      }
    }
  }

  const now = Date.now();

  if (Object.keys(modelStats).length === 0) {
    console.log('[geo:status] No run results yet — GEO runs happen on the configured schedule (Mon/Wed/Fri).');
    console.log('[geo:status] Check https://geo.senso.ai after the next scheduled run.\n');
    for (const model of ['chatgpt', 'claude', 'perplexity', 'gemini']) {
      gauge('geo.last_run_age_seconds', -1, { model });
    }
    return;
  }

  console.log('Model        Prompts  Mentions  Citations  Last Run');
  console.log('─'.repeat(65));
  for (const [model, stats] of Object.entries(modelStats)) {
    const ageSeconds = stats.lastRunAt ? Math.floor((now - stats.lastRunAt.getTime()) / 1000) : -1;
    const ageStr = stats.lastRunAt ? `${Math.floor(ageSeconds / 3600)}h ago` : 'never';
    const mentionRate = stats.prompts > 0 ? `${stats.mentions}/${stats.prompts}` : '—';
    console.log(
      `${model.padEnd(12)} ${String(stats.prompts).padEnd(8)} ${mentionRate.padEnd(9)} ${String(stats.citations).padEnd(10)} ${ageStr}`
    );
    gauge('geo.mention_score', stats.prompts > 0 ? stats.mentions / stats.prompts : 0, { model });
    gauge('geo.citation_count', stats.citations, { model });
    gauge('geo.last_run_age_seconds', ageSeconds, { model });
    if (stats.mentions > 0) increment('geo.brand_mentioned', { model });
  }

  console.log('\n[geo:status] Metrics emitted to Datadog under shop3.geo.*');
  console.log('[geo:status] Full dashboard: https://geo.senso.ai');
}

main().catch((err) => {
  console.error('[geo:status] Failed:', err.message);
  process.exit(1);
});

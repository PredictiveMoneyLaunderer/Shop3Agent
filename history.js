require('dotenv').config();
const { getRecentPurchases, getAnalytics } = require('./memory');

const args = process.argv.slice(2);
const statsMode = args.includes('--stats');
const limitArg = args.find((a) => !a.startsWith('--'));
const limit = parseInt(limitArg, 10) || 10;

if (statsMode) {
  getAnalytics()
    .then(({ topDomains, toolsDistribution, summary }) => {
      console.log('\n── Shop3 Analytics (last 7 days) ──────────────────────────\n');

      console.log('Top source domains:');
      if (topDomains.length === 0) {
        console.log('  (no data)');
      } else {
        topDomains.forEach((r) => console.log(`  ${String(r.picks).padEnd(4)} ${r.domain}`));
      }

      console.log('\nTools per purchase:');
      if (toolsDistribution.length === 0) {
        console.log('  (no data)');
      } else {
        toolsDistribution.forEach((r) =>
          console.log(`  ${r.tool_count} tools → ${r.purchases} purchase(s)`)
        );
      }

      console.log('\nSummary:');
      console.log(`  Purchases:    ${summary.total_purchases ?? 0}`);
      console.log(`  Total spent:  $${parseFloat(summary.total_spent_usd ?? 0).toFixed(2)}`);
      console.log(`  Avg price:    $${parseFloat(summary.avg_price_usd ?? 0).toFixed(2)}`);
      console.log(`  Avg duration: ${parseFloat(summary.avg_duration_s ?? 0).toFixed(1)}s`);
      console.log('\n─'.repeat(55));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[history] Analytics failed:', err.message);
      process.exit(1);
    });
} else {
  getRecentPurchases(limit)
    .then((rows) => {
      if (rows.length === 0) {
        console.log('No purchases yet.');
        process.exit(0);
      }

      console.log(`\nLast ${rows.length} purchase(s):\n`);
      console.log('─'.repeat(100));

      for (const row of rows) {
        console.log(`Time:    ${row.timestamp}`);
        console.log(`Query:   ${row.query}`);
        console.log(`Product: ${row.selected_result}`);
        console.log(`Price:   ${row.price}`);
        console.log(`Tx:      ${row.tx_hash}`);
        console.log(`Source:  ${row.source_url}`);
        if (row.tools_invoked?.length) {
          console.log(`Tools:   ${row.tools_invoked.join(' → ')}`);
        }
        if (row.total_latency_ms) {
          console.log(`Time:    ${(row.total_latency_ms / 1000).toFixed(1)}s`);
        }
        console.log('─'.repeat(100));
      }

      process.exit(0);
    })
    .catch((err) => {
      console.error('[history] Failed:', err.message);
      process.exit(1);
    });
}

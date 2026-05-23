require('dotenv').config();
const { getRecentPurchases } = require('./memory');

const limit = parseInt(process.argv[2], 10) || 10;

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
      console.log(`Tx:      https://sepolia.basescan.org/tx/${row.tx_hash}`);
      console.log(`Source:  ${row.source_url}`);
      console.log('─'.repeat(100));
    }

    process.exit(0);
  })
  .catch((err) => {
    console.error('[history] Failed:', err.message);
    process.exit(1);
  });

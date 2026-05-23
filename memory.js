const { createClient } = require('@clickhouse/client');

let client;

function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
    });
  }
  return client;
}

async function ensureTable() {
  await getClient().exec({
    query: `
      CREATE TABLE IF NOT EXISTS agent_purchases (
        timestamp DateTime DEFAULT now(),
        query String,
        selected_result String,
        price String,
        tx_hash String,
        source_url String
      ) ENGINE = MergeTree()
      ORDER BY timestamp
    `,
  });
}

async function logPurchase({ query, selectedResult, price, txHash, sourceUrl }) {
  await ensureTable();
  await getClient().insert({
    table: 'agent_purchases',
    values: [
      {
        query,
        selected_result: selectedResult,
        price,
        tx_hash: txHash,
        source_url: sourceUrl,
      },
    ],
    format: 'JSONEachRow',
  });
  console.log('[memory] Purchase logged to ClickHouse');
}

async function getRecentPurchases(limit = 10) {
  await ensureTable();
  const result = await getClient().query({
    query: `SELECT * FROM agent_purchases ORDER BY timestamp DESC LIMIT {limit:UInt32}`,
    query_params: { limit },
    format: 'JSONEachRow',
  });
  return await result.json();
}

module.exports = { logPurchase, getRecentPurchases };

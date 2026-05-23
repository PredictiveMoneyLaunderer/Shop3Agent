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
  await getClient().exec({
    query: `
      CREATE TABLE IF NOT EXISTS agent_spend (
        timestamp DateTime DEFAULT now(),
        amount_usd Float64
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

async function recordSpend(amountUSD) {
  await ensureTable();
  await getClient().insert({
    table: 'agent_spend',
    values: [{ amount_usd: amountUSD }],
    format: 'JSONEachRow',
  });
}

async function getSpendToday() {
  await ensureTable();
  const today = new Date().toISOString().slice(0, 10);
  const result = await getClient().query({
    query: `SELECT sum(amount_usd) as total FROM agent_spend WHERE toDate(timestamp) = {today:String}`,
    query_params: { today },
    format: 'JSONEachRow',
  });
  const rows = await result.json();
  return parseFloat(rows[0]?.total ?? 0);
}

module.exports = { logPurchase, getRecentPurchases, recordSpend, getSpendToday };

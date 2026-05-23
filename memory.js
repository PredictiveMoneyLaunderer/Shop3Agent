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
  const db = getClient();
  await db.exec({
    query: `
      CREATE TABLE IF NOT EXISTS agent_purchases (
        timestamp DateTime DEFAULT now(),
        query String,
        selected_result String,
        price String,
        tx_hash String,
        source_url String,
        nimble_results_count UInt32 DEFAULT 0,
        total_latency_ms UInt64 DEFAULT 0,
        tools_invoked Array(String) DEFAULT [],
        price_usd Float32 DEFAULT 0
      ) ENGINE = MergeTree()
      ORDER BY timestamp
    `,
  });
  // Idempotent column additions for existing tables
  for (const col of [
    'nimble_results_count UInt32 DEFAULT 0',
    'total_latency_ms UInt64 DEFAULT 0',
    'tools_invoked Array(String) DEFAULT []',
    'price_usd Float32 DEFAULT 0',
  ]) {
    await db.exec({ query: `ALTER TABLE agent_purchases ADD COLUMN IF NOT EXISTS ${col}` });
  }
  await db.exec({
    query: `
      CREATE TABLE IF NOT EXISTS agent_spend (
        timestamp DateTime DEFAULT now(),
        amount_usd Float64
      ) ENGINE = MergeTree()
      ORDER BY timestamp
    `,
  });
}

async function logPurchase({ query, selectedResult, price, txHash, sourceUrl,
  nimbleResultsCount = 0, totalLatencyMs = 0, toolsInvoked = [], priceUsd = 0 }) {
  await ensureTable();
  await getClient().insert({
    table: 'agent_purchases',
    values: [{
      query,
      selected_result: selectedResult,
      price,
      tx_hash: txHash,
      source_url: sourceUrl,
      nimble_results_count: nimbleResultsCount,
      total_latency_ms: totalLatencyMs,
      tools_invoked: toolsInvoked,
      price_usd: priceUsd,
    }],
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

async function getAnalytics() {
  await ensureTable();
  const db = getClient();

  const [domainsRes, toolsRes, summaryRes] = await Promise.all([
    db.query({
      query: `
        SELECT extract(source_url, 'https?://([^/]+)') AS domain, count() AS picks
        FROM agent_purchases
        GROUP BY domain ORDER BY picks DESC LIMIT 5
      `,
      format: 'JSONEachRow',
    }),
    db.query({
      query: `
        SELECT length(tools_invoked) AS tool_count, count() AS purchases
        FROM agent_purchases
        GROUP BY tool_count ORDER BY tool_count
      `,
      format: 'JSONEachRow',
    }),
    db.query({
      query: `
        SELECT count() AS total_purchases,
               sum(price_usd) AS total_spent_usd,
               avg(price_usd) AS avg_price_usd,
               avg(total_latency_ms / 1000) AS avg_duration_s
        FROM agent_purchases
        WHERE timestamp > now() - INTERVAL 7 DAY
      `,
      format: 'JSONEachRow',
    }),
  ]);

  return {
    topDomains: await domainsRes.json(),
    toolsDistribution: await toolsRes.json(),
    summary: (await summaryRes.json())[0] ?? {},
  };
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

module.exports = { logPurchase, getRecentPurchases, getAnalytics, recordSpend, getSpendToday };

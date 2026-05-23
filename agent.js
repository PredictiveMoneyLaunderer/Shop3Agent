const Anthropic = require('@anthropic-ai/sdk');
const { searchWeb } = require('./search');
const { mockPaymentFlow, getWalletAddress } = require('./payment');
const { logPurchase, getRecentPurchases } = require('./memory');
const { publishReceipt } = require('./publish');
const { notifyPurchase } = require('./notify');
const { withSpan, withLLMSpan, increment, gauge, timing } = require('./telemetry');

const MAX_TURNS = parseInt(process.env.MAX_AGENT_TURNS) || 10;
const client = new Anthropic();

const tools = [
  {
    name: 'search_web',
    description: 'Search the web for products, services, or information using Nimble. Returns titles, URLs, and descriptions.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        num_results: { type: 'number', description: 'Number of results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'pay_for_purchase',
    description: 'Pay for a selected product/service from the agent smart wallet using USDC on ARC-TESTNET. Enforces a daily spending limit.',
    input_schema: {
      type: 'object',
      properties: {
        selected_result: { type: 'string', description: 'Name/title of the product being purchased' },
        price: { type: 'string', description: 'Price string (e.g. "$5.00", "$9.99/mo")' },
        source_url: { type: 'string', description: 'URL of the product page' },
      },
      required: ['selected_result', 'price', 'source_url'],
    },
  },
  {
    name: 'log_to_database',
    description: 'Log a completed purchase to ClickHouse for audit trail.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Original user query' },
        selected_result: { type: 'string', description: 'What was purchased' },
        price: { type: 'string', description: 'Price paid' },
        tx_hash: { type: 'string', description: 'Blockchain transaction hash' },
        source_url: { type: 'string', description: 'Source URL' },
      },
      required: ['query', 'selected_result', 'price', 'tx_hash', 'source_url'],
    },
  },
  {
    name: 'publish_receipt',
    description: 'Publish a verified purchase receipt to cited.md via Senso. Returns a public URL.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Original user query' },
        selected_result: { type: 'string', description: 'What was purchased' },
        price: { type: 'string', description: 'Price paid' },
        tx_hash: { type: 'string', description: 'Blockchain transaction hash' },
        source_url: { type: 'string', description: 'Source URL' },
        search_results: {
          type: 'array',
          description: 'All search results considered',
          items: { type: 'object' },
        },
      },
      required: ['query', 'selected_result', 'price', 'tx_hash', 'source_url'],
    },
  },
  {
    name: 'check_purchase_history',
    description: 'Check what Shop3 has already purchased. Use this before buying to avoid duplicates.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of recent purchases to retrieve (default 10)' },
      },
      required: [],
    },
  },
];

async function executeTool(name, input, context, dryRun) {
  switch (name) {
    case 'search_web': {
      console.log(`\n[agent] Searching: "${input.query}"`);
      const start = Date.now();
      const results = await withSpan('agent.tool.search_web', { query: input.query }, () =>
        searchWeb(input.query, input.num_results ?? 5)
      );
      context.searchResults = results;
      timing('tool.duration_ms', Date.now() - start, { tool: 'search_web' });
      gauge('search.results_count', results.length, { query: input.query });
      console.log(`[agent] Found ${results.length} results`);
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.title} — ${r.url}`));
      return results;
    }

    case 'pay_for_purchase': {
      if (dryRun) {
        console.log(`\n[agent] DRY RUN — would pay for: ${input.selected_result} (${input.price})`);
        context.txHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
        context.selectedResult = input.selected_result;
        context.price = input.price;
        context.sourceUrl = input.source_url;
        increment('payment.dry_run');
        return { success: true, dry_run: true, tx_hash: context.txHash };
      }
      console.log(`\n[agent] Paying for: ${input.selected_result} (${input.price})`);
      const start = Date.now();
      const txHash = await withSpan('agent.tool.pay_for_purchase', {
        product: input.selected_result,
        price: input.price,
      }, () => mockPaymentFlow(input.selected_result, input.price));
      context.txHash = txHash;
      context.selectedResult = input.selected_result;
      context.price = input.price;
      context.sourceUrl = input.source_url;
      timing('tool.duration_ms', Date.now() - start, { tool: 'pay_for_purchase' });
      return { success: true, tx_hash: txHash };
    }

    case 'log_to_database': {
      console.log(`\n[agent] Logging purchase to ClickHouse`);
      await withSpan('agent.tool.log_to_database', {}, () =>
        logPurchase({
          query: input.query,
          selectedResult: input.selected_result,
          price: input.price,
          txHash: input.tx_hash,
          sourceUrl: input.source_url,
        })
      );
      return { success: true };
    }

    case 'publish_receipt': {
      if (dryRun) {
        console.log(`\n[agent] DRY RUN — skipping receipt publish for: ${input.selected_result}`);
        return { success: true, dry_run: true, receipt_url: null };
      }
      console.log(`\n[agent] Publishing receipt to cited.md`);
      const url = await withSpan('agent.tool.publish_receipt', {}, () =>
        publishReceipt({
          query: input.query,
          selectedResult: input.selected_result,
          price: input.price,
          txHash: input.tx_hash,
          sourceUrl: input.source_url,
          searchResults: input.search_results ?? context.searchResults ?? [],
        })
      );
      context.receiptUrl = url;
      return { success: true, receipt_url: url };
    }

    case 'check_purchase_history': {
      const purchases = await withSpan('agent.tool.check_purchase_history', {}, () =>
        getRecentPurchases(input.limit ?? 10)
      );
      if (purchases.length === 0) {
        return { purchases: [], message: 'No purchases yet.' };
      }
      return {
        purchases: purchases.map((p) => ({
          product: p.selected_result,
          price: p.price,
          when: p.timestamp,
          tx_hash: p.tx_hash,
        })),
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function runAgent(userPrompt, { dryRun = false } = {}) {
  const runStart = Date.now();
  increment('agent.run.started');
  if (dryRun) increment('agent.run.dry_run');

  const walletAddress = await getWalletAddress();
  console.log(`\n[agent] Smart wallet: ${walletAddress}`);
  if (dryRun) console.log('[agent] DRY RUN MODE — no payments or receipts will be submitted');
  console.log(`[agent] Starting: "${userPrompt}"\n`);

  const context = {};
  const messages = [{ role: 'user', content: userPrompt }];

  const systemPrompt = `You are Shop3, an autonomous Web3 shopping agent. Your job is to:
1. (Optional) Check purchase history to avoid buying duplicates
2. Search the web to find the best option matching the user's request
3. Evaluate results and select the best one under the user's budget
4. Pay for it autonomously from your smart wallet (USDC on ARC-TESTNET)
5. Log the purchase to the database
6. Publish a verified receipt

Your smart wallet address is: ${walletAddress}
Daily spend limit: $${parseFloat(process.env.MAX_DAILY_USD) || 10} USD (enforced on-chain)
Network: ARC-TESTNET
Payment token: USDC
${dryRun ? '\nDRY RUN: You are in simulation mode. Payments will not be executed and receipts will not be published.' : ''}

When selecting a result to buy, prefer options that are:
- Under $10/month or one-time
- Have clear pricing
- Are reputable API services or products

Always complete all steps: search → pay → log → publish. Do not stop early.`;

  let turns = 0;

  while (true) {
    if (turns >= MAX_TURNS) {
      throw new Error(`Agent exceeded maximum turn limit (${MAX_TURNS}). Aborting to prevent runaway loop.`);
    }
    turns++;

    const response = await withLLMSpan('claude-sonnet-4-6', () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      })
    );

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      timing('agent.run.duration_ms', Date.now() - runStart);
      increment('agent.run.completed');
      gauge('agent.run.turns', turns);
      console.log('\n[agent] Done.\n');
      console.log(finalText);

      await notifyPurchase({
        selectedResult: context.selectedResult,
        price: context.price,
        txHash: context.txHash,
        receiptUrl: context.receiptUrl,
        dryRun,
      });

      return { summary: finalText, ...context };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result;
        try {
          result = await executeTool(block.name, block.input, context, dryRun);
        } catch (err) {
          console.error(`[agent] Tool error (${block.name}):`, err.message);
          increment('agent.tool.error', { tool: block.name });
          result = { error: err.message };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}

module.exports = { runAgent };

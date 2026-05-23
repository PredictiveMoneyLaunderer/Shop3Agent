const Anthropic = require('@anthropic-ai/sdk');
const { searchWeb } = require('./search');
const { mockPaymentFlow, getWalletAddress } = require('./payment');
const { logPurchase } = require('./memory');
const { publishReceipt } = require('./publish');

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
    description: 'Pay for a selected product/service from the agent smart wallet using USDC on Base Sepolia. Enforces $10/day spending limit.',
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
];

async function executeTool(name, input, context) {
  switch (name) {
    case 'search_web': {
      console.log(`\n[agent] Searching: "${input.query}"`);
      const results = await searchWeb(input.query, input.num_results ?? 5);
      context.searchResults = results;
      console.log(`[agent] Found ${results.length} results`);
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.title} — ${r.url}`));
      return results;
    }

    case 'pay_for_purchase': {
      console.log(`\n[agent] Paying for: ${input.selected_result} (${input.price})`);
      const txHash = await mockPaymentFlow(input.selected_result, input.price);
      context.txHash = txHash;
      context.selectedResult = input.selected_result;
      context.price = input.price;
      context.sourceUrl = input.source_url;
      return { success: true, tx_hash: txHash };
    }

    case 'log_to_database': {
      console.log(`\n[agent] Logging purchase to ClickHouse`);
      await logPurchase({
        query: input.query,
        selectedResult: input.selected_result,
        price: input.price,
        txHash: input.tx_hash,
        sourceUrl: input.source_url,
      });
      return { success: true };
    }

    case 'publish_receipt': {
      console.log(`\n[agent] Publishing receipt to cited.md`);
      const url = await publishReceipt({
        query: input.query,
        selectedResult: input.selected_result,
        price: input.price,
        txHash: input.tx_hash,
        sourceUrl: input.source_url,
        searchResults: input.search_results ?? context.searchResults ?? [],
      });
      context.receiptUrl = url;
      return { success: true, receipt_url: url };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function runAgent(userPrompt) {
  const walletAddress = await getWalletAddress();
  console.log(`\n[agent] Smart wallet: ${walletAddress}`);
  console.log(`[agent] Starting: "${userPrompt}"\n`);

  const context = {};
  const messages = [
    {
      role: 'user',
      content: userPrompt,
    },
  ];

  const systemPrompt = `You are an autonomous Web3 shopping agent. Your job is to:
1. Search the web to find the best option matching the user's request
2. Evaluate results and select the best one under the user's budget
3. Pay for it autonomously from your smart wallet (USDC on Base Sepolia testnet)
4. Log the purchase to the database
5. Publish a verified receipt

Your smart wallet address is: ${walletAddress}
Daily spend limit: $10 USD (enforced on-chain)
Network: Base Sepolia (testnet)
Payment token: USDC

When selecting a result to buy, prefer options that are:
- Under $10/month or one-time
- Have clear pricing
- Are reputable API services or products

Always complete all 4 steps: search → pay → log → publish. Do not stop early.`;

  // Agentic loop
  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      console.log('\n[agent] Done.\n');
      console.log(finalText);
      return { summary: finalText, ...context };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result;
        try {
          result = await executeTool(block.name, block.input, context);
        } catch (err) {
          console.error(`[agent] Tool error (${block.name}):`, err.message);
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

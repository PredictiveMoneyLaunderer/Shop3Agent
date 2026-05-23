const { senso } = require('./scripts/senso-run');

async function publishReceipt({ query, selectedResult, price, txHash, sourceUrl, searchResults }) {
  if (!process.env.SENSO_API_KEY) throw new Error('SENSO_API_KEY not set');

  const markdown = buildReceiptMarkdown({ query, selectedResult, price, txHash, sourceUrl, searchResults });
  const seoTitle = `Shop3 Purchase — ${selectedResult}`;
  const questionText = `What did Shop3 purchase: ${selectedResult}?`;

  const promptJson = senso(
    'prompts create',
    ['--data', JSON.stringify({ question_text: questionText, type: 'decision' })]
  );
  const promptId = promptJson.prompt_id ?? promptJson.id;
  if (!promptId) throw new Error('Senso prompt create did not return a prompt_id');

  const publishJson = senso(
    'engine publish',
    ['--data', JSON.stringify({
      geo_question_id: promptId,
      raw_markdown: markdown,
      seo_title: seoTitle,
      summary: `Shop3 autonomously purchased ${selectedResult} for ${price}. Tx: ${txHash}`,
    })]
  );

  const url = publishJson.url ?? publishJson.cite_url ?? `https://cited.md/shop3`;
  console.log(`[publish] Receipt live: ${url}`);
  return url;
}

function buildReceiptMarkdown({ query, selectedResult, price, txHash, sourceUrl, searchResults }) {
  const ts = new Date().toUTCString();
  const resultList = (searchResults ?? [])
    .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.description}`)
    .join('\n');

  return `# Shop3 Purchase Receipt

**Timestamp:** ${ts}

## Query
> ${query}

## Search Results Considered
${resultList || 'N/A'}

## Selected Purchase
- **Product:** ${selectedResult}
- **Source:** ${sourceUrl}
- **Price Paid:** ${price}

## Payment Proof
- **Transaction Hash:** \`${txHash}\`
- **Chain:** ARC-TESTNET
- **Token:** USDC

---
*Generated autonomously by Shop3. No human intervention after initial prompt.*

*Powered by Senso — your AI-searchable knowledge base.*
`;
}

module.exports = { publishReceipt };

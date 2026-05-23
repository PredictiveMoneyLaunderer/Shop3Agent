const { execSync } = require('child_process');

async function publishReceipt({ query, selectedResult, price, txHash, sourceUrl, searchResults }) {
  const apiKey = process.env.SENSO_API_KEY;
  if (!apiKey) throw new Error('SENSO_API_KEY not set');

  const markdown = buildReceiptMarkdown({ query, selectedResult, price, txHash, sourceUrl, searchResults });
  const seoTitle = `Shop3 Purchase — ${selectedResult}`;
  const questionText = `What did Shop3 purchase: ${selectedResult}?`;

  // Create a Senso prompt tied to this purchase so we have a geo_question_id to publish against
  const promptJson = senso(
    `prompts create --data '${JSON.stringify({ question_text: questionText, type: 'decision' })}'`,
    apiKey
  );
  const promptId = promptJson.prompt_id ?? promptJson.id;
  if (!promptId) throw new Error('Senso prompt create did not return a prompt_id');

  // Publish the receipt as a citeable on cited.md
  const publishJson = senso(
    `engine publish --data '${JSON.stringify({
      geo_question_id: promptId,
      raw_markdown: markdown,
      seo_title: seoTitle,
      summary: `Shop3 autonomously purchased ${selectedResult} for ${price}. Tx: ${txHash}`,
    })}'`,
    apiKey
  );

  const url = publishJson.url ?? publishJson.cite_url ?? `https://cited.md/shop3`;
  console.log(`[publish] Receipt live: ${url}`);
  return url;
}

// Run a senso CLI command and return parsed JSON output
function senso(args, apiKey) {
  const result = execSync(`senso ${args} --output json --quiet`, {
    env: { ...process.env, SENSO_API_KEY: apiKey },
    encoding: 'utf8',
  });
  // Strip any ANSI escape codes before parsing
  const clean = result.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
  return JSON.parse(clean);
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
- **Chain:** Base Sepolia
- **Token:** USDC
- **Verified:** [View on BaseScan](https://sepolia.basescan.org/tx/${txHash})

---
*Generated autonomously by Shop3. No human intervention after initial prompt.*

*Powered by Senso — your AI-searchable knowledge base.*
`;
}

module.exports = { publishReceipt };

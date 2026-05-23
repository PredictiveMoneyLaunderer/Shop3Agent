const axios = require('axios');

async function publishReceipt({ query, selectedResult, price, txHash, sourceUrl, searchResults }) {
  const apiKey = process.env.SENSO_API_KEY;
  if (!apiKey) throw new Error('SENSO_API_KEY not set');

  const content = buildReceiptMarkdown({ query, selectedResult, price, txHash, sourceUrl, searchResults });

  const response = await axios.post(
    'https://api.senso.ai/v1/publish',
    {
      title: `Agent Purchase Receipt — ${new Date().toISOString()}`,
      content,
      tags: ['agent', 'web3', 'purchase', 'receipt'],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const url = response.data?.url ?? response.data?.cite_url ?? null;
  console.log(`[publish] Receipt published: ${url}`);
  return url;
}

function buildReceiptMarkdown({ query, selectedResult, price, txHash, sourceUrl, searchResults }) {
  const ts = new Date().toUTCString();
  const resultList = (searchResults ?? [])
    .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.description}`)
    .join('\n');

  return `# Agent Purchase Receipt

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
*Generated autonomously by Valution Agent. No human intervention after initial prompt.*
`;
}

module.exports = { publishReceipt };

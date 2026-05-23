const axios = require('axios');

async function searchWeb(query, numResults = 5) {
  const apiKey = process.env.NIMBLE_API_KEY;
  if (!apiKey) throw new Error('NIMBLE_API_KEY not set');

  const response = await axios.post(
    'https://sdk.nimbleway.com/v1/search',
    { query, max_results: numResults },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const results = response.data?.results ?? [];
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

module.exports = { searchWeb };

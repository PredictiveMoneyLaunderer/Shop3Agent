const { fetchWithPayment } = require('./payment');

async function searchWeb(query, numResults = 5, schema = null) {
  const middlewareUrl = process.env.SEARCH_MIDDLEWARE_URL;
  if (!middlewareUrl) throw new Error('SEARCH_MIDDLEWARE_URL not set — start the middleware with: npm run start:server');

  const url = new URL(middlewareUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('num_results', String(numResults));
  if (schema) url.searchParams.set('schema', JSON.stringify(schema));

  const { data } = await fetchWithPayment(url.toString());
  return data?.results ?? [];
}

module.exports = { searchWeb };

const tracer = require('dd-trace').init({
  service: 'shop3-agent',
  env: process.env.NODE_ENV || 'development',
  hostname: process.env.DD_AGENT_HOST || 'localhost',
  port: process.env.DD_AGENT_PORT || 8126,
  logInjection: true,
});

// Wrap an async fn in a named span. The span is passed as the first arg to fn
// so callers can call span.setTag() to attach dynamic results.
async function withSpan(name, tags, fn) {
  return tracer.trace(name, { tags }, (span) => fn(span));
}

// Wrap a Claude API call so lapdog captures it as an LLM span with token/cost metadata.
// usage = { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
// model = e.g. 'claude-sonnet-4-6'
async function withLLMSpan(model, fn) {
  return tracer.trace('claude.completion', { tags: { 'llm.provider': 'anthropic', 'llm.model': model } }, async (span) => {
    const result = await fn();
    const usage = result?.usage;
    if (usage && span) {
      span.setTag('llm.usage.input_tokens', usage.input_tokens ?? 0);
      span.setTag('llm.usage.output_tokens', usage.output_tokens ?? 0);
      span.setTag('llm.usage.cache_read_tokens', usage.cache_read_input_tokens ?? 0);
      span.setTag('llm.usage.cache_creation_tokens', usage.cache_creation_input_tokens ?? 0);
    }
    return result;
  });
}

// Increment a counter metric
function increment(metric, tags = {}) {
  tracer.dogstatsd.increment(`shop3.${metric}`, 1, tagsArray(tags));
}

// Record a gauge value
function gauge(metric, value, tags = {}) {
  tracer.dogstatsd.gauge(`shop3.${metric}`, value, tagsArray(tags));
}

// Record a timing in ms
function timing(metric, ms, tags = {}) {
  tracer.dogstatsd.distribution(`shop3.${metric}`, ms, tagsArray(tags));
}

function tagsArray(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`);
}

module.exports = { tracer, withSpan, withLLMSpan, increment, gauge, timing };

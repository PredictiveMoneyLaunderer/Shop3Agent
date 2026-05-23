const axios = require('axios');

async function notifyPurchase({ selectedResult, price, txHash, receiptUrl, dryRun = false }) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;

  const payload = {
    event: dryRun ? 'shop3.dry_run' : 'shop3.purchase_complete',
    product: selectedResult,
    price,
    tx_hash: txHash ?? null,
    receipt_url: receiptUrl ?? null,
    timestamp: new Date().toISOString(),
  };

  try {
    await axios.post(url, payload, { timeout: 5000 });
    console.log(`[notify] Webhook delivered to ${url}`);
  } catch (err) {
    console.warn(`[notify] Webhook failed (non-fatal): ${err.message}`);
  }
}

module.exports = { notifyPurchase };

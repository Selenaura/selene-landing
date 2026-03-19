const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify Stripe signature
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    event = verifyStripeSignature(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details && session.customer_details.email;
    const productName = session.metadata && session.metadata.product_name || 'Carta Astral';
    const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '0';

    if (email) {
      try {
        await updateBrevoContact(email, productName, amount);
        console.log('Brevo updated for', email, '-', productName);
      } catch (err) {
        console.error('Brevo update failed:', err.message);
        // Don't fail the webhook - Stripe would retry
      }
    }
  }

  return res.status(200).json({ received: true });
};

function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = {};
  sigHeader.split(',').forEach(function(item) {
    const kv = item.split('=');
    if (kv[0] === 't') parts.t = kv[1];
    if (kv[0] === 'v1') parts.v1 = kv[1];
  });

  if (!parts.t || !parts.v1) {
    throw new Error('Invalid signature format');
  }

  const signedPayload = parts.t + '.' + payload;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  if (expectedSig !== parts.v1) {
    throw new Error('Signature mismatch');
  }

  // Check timestamp tolerance (5 min)
  const now = Math.floor(Date.now() / 1000);
  if (now - parseInt(parts.t) > 300) {
    throw new Error('Timestamp too old');
  }

  return JSON.parse(payload);
}

async function updateBrevoContact(email, productName, amount) {
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) {
    console.warn('No BREVO_API_KEY - skipping Brevo update');
    return;
  }

  await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': brevoKey
    },
    body: JSON.stringify({
      email: email,
      attributes: {
        HA_COMPRADO: true,
        PRODUCTO_COMPRADO: productName,
        IMPORTE_COMPRA: amount,
        FECHA_COMPRA: new Date().toISOString().split('T')[0]
      },
      listIds: [2],
      updateEnabled: true
    })
  });
}

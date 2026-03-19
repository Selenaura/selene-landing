var crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  // Stripe sends raw body — Vercel parses it, so we reconstruct from req.body
  var rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  var event;
  try {
    event = verifySignature(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    var session = event.data.object;
    var email = session.customer_email || (session.customer_details && session.customer_details.email);

    if (email) {
      try {
        await updateBrevoContact(email, session.metadata && session.metadata.product);
      } catch (err) {
        console.error('Brevo update failed:', err.message);
      }
    }
  }

  return res.status(200).json({ received: true });
};

// Verify Stripe webhook signature using HMAC-SHA256
function verifySignature(payload, sigHeader, secret) {
  var parts = {};
  sigHeader.split(',').forEach(function(part) {
    var kv = part.split('=');
    parts[kv[0].trim()] = kv[1];
  });

  var timestamp = parts['t'];
  var signature = parts['v1'];

  if (!timestamp || !signature) {
    throw new Error('Invalid signature header format');
  }

  // Reject timestamps older than 5 minutes
  var now = Math.floor(Date.now() / 1000);
  if (now - parseInt(timestamp) > 300) {
    throw new Error('Timestamp too old');
  }

  var signedPayload = timestamp + '.' + payload;
  var expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (expected !== signature) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(payload);
}

// Update Brevo contact: mark as purchaser to stop sales emails
async function updateBrevoContact(email, product) {
  var brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) {
    console.warn('No BREVO_API_KEY');
    return;
  }

  await fetch('https://api.brevo.com/v3/contacts', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'api-key': brevoKey
    },
    body: JSON.stringify({
      email: email,
      attributes: {
        HA_COMPRADO: true,
        PRODUCTO_COMPRADO: product || 'carta-astral'
      }
    })
  });
}

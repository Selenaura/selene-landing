const crypto = require('crypto');

// Disable Vercel's automatic body parsing - we need the raw body for signature verification
module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Read raw body from stream
  const rawBody = await getRawBody(req);

  // Verify Stripe signature
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    event = verifyStripeSignature(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details && session.customer_details.email;
    const productName = (session.metadata && session.metadata.product_name) || 'Carta Astral';
    const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '0';

    if (email) {
      try {
        await updateBrevoContact(email, productName, amount);
        console.log('Brevo updated for', email, '-', productName);
      } catch (err) {
        console.error('Brevo update failed:', err.message);
      }
      try {
        await trackFunnelEvent('compra', null, email, productName, session.amount_total || 0);
        console.log('Funnel event tracked: compra', email);
      } catch (err) {
        console.error('Funnel track failed:', err.message);
      }

      // Schedule post-purchase email sequence
      try {
        await schedulePostPurchase(email, productName);
        console.log('Post-purchase emails scheduled for', email);
      } catch (err) {
        console.error('Post-purchase schedule failed:', err.message);
      }
    }
  }

  return res.status(200).json({ received: true });
};

function getRawBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

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

async function trackFunnelEvent(eventType, sign, email, producto, importeCents) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.warn('No SUPABASE vars for tracking'); return; }
  await fetch(url + '/rest/v1/funnel_events', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      event_type: eventType,
      signo_solar: sign || null,
      email: email || null,
      producto: producto || null,
      importe_cents: importeCents || null
    })
  });
}

async function schedulePostPurchase(email, productName) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.warn('No SUPABASE vars for post-purchase'); return; }

  var now = Date.now();
  var HOUR = 3600000;
  var DAY = 86400000;

  // Get sign from Brevo contact (if available)
  var sign = null;
  var brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    try {
      var cRes = await fetch('https://api.brevo.com/v3/contacts/' + encodeURIComponent(email), {
        headers: { 'api-key': brevoKey, 'Accept': 'application/json' }
      });
      if (cRes.ok) {
        var contact = await cRes.json();
        sign = contact.attributes && contact.attributes.SIGNO_SOLAR || null;
      }
    } catch (e) { /* ignore */ }
  }

  var steps = [
    { step: 10, delay: 1 * HOUR },
    { step: 11, delay: 3 * DAY },
    { step: 12, delay: 7 * DAY }
  ];

  var rows = steps.map(function(s) {
    return {
      email: email,
      signo_solar: sign,
      signo_en: null,
      lang: 'es',
      step: s.step,
      next_send_at: new Date(now + s.delay).toISOString(),
      sent: false
    };
  });

  await fetch(url + '/rest/v1/email_sequence', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
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

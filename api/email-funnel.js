// Email Funnel — Cron endpoint that sends scheduled nurturing emails
// Triggered by Vercel Cron every hour: GET /api/email-funnel

module.exports = async function handler(req, res) {
  // Allow GET (Vercel cron) and POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional: verify cron secret
  var cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== 'Bearer ' + cronSecret) {
    // Allow without auth if no CRON_SECRET is set
    if (cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  var BREVO_KEY = process.env.BREVO_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY || !BREVO_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  try {
    // Fetch pending emails where next_send_at <= now and sent = false
    var now = new Date().toISOString();
    var fetchRes = await fetch(
      SUPABASE_URL + '/rest/v1/email_sequence?sent=eq.false&next_send_at=lte.' + now + '&order=next_send_at.asc&limit=50',
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    var pending = await fetchRes.json();
    if (!Array.isArray(pending) || pending.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No pending emails' });
    }

    var sentCount = 0;
    var errors = [];

    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      try {
        var emailContent = getEmailContent(item.step, item.signo_solar, item.signo_en, item.lang);
        if (!emailContent) {
          // Unknown step, mark as sent to avoid retrying
          await markSent(SUPABASE_URL, SUPABASE_KEY, item.id);
          continue;
        }

        // Send via Brevo
        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': BREVO_KEY
          },
          body: JSON.stringify({
            sender: { name: 'Selene', email: 'info@selenaura.com' },
            to: [{ email: item.email }],
            subject: emailContent.subject,
            htmlContent: emailContent.html
          })
        });

        // Mark as sent
        await markSent(SUPABASE_URL, SUPABASE_KEY, item.id);

        // Track funnel event
        await fetch(SUPABASE_URL + '/rest/v1/funnel_events', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            event_type: 'email_nurture_' + item.step,
            signo_solar: item.signo_solar || null,
            email: item.email
          })
        });

        sentCount++;
        console.log('Sent email step ' + item.step + ' to ' + item.email);
      } catch (err) {
        errors.push({ email: item.email, step: item.step, error: err.message });
        console.error('Failed to send email step ' + item.step + ' to ' + item.email + ':', err.message);
      }
    }

    return res.status(200).json({ sent: sentCount, errors: errors.length, details: errors });
  } catch (err) {
    console.error('Email funnel error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function markSent(url, key, id) {
  await fetch(url + '/rest/v1/email_sequence?id=eq.' + id, {
    method: 'PATCH',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ sent: true })
  });
}

// ═══════════════════════════════════════════════════════════
// EMAIL CONTENT — 5-step nurture sequence
// ═══════════════════════════════════════════════════════════

function getEmailContent(step, sign, signEn, lang) {
  var isEn = lang === 'en';
  var signName = isEn ? (signEn || sign) : (sign || signEn);

  var emails = {
    // Step 2 (Day 2): Science fact about their sign
    2: {
      subject: isEn
        ? '✦ The science behind ' + signName + ' — what research says'
        : '✦ La ciencia detrás de ' + signName + ' — lo que dice la investigación',
      body: isEn
        ? getStep2En(signName)
        : getStep2Es(signName)
    },
    // Step 3 (Day 5): What a full birth chart reveals
    3: {
      subject: isEn
        ? '✦ What your birth chart reveals (and your horoscope doesn\'t)'
        : '✦ Lo que tu carta natal revela (y tu horóscopo no)',
      body: isEn
        ? getStep3En(signName)
        : getStep3Es(signName)
    },
    // Step 4 (Day 8): Rising sign teaser
    4: {
      subject: isEn
        ? '✦ Your rising sign matters more than you think, ' + signName
        : '✦ Tu ascendente importa más de lo que crees, ' + signName,
      body: isEn
        ? getStep4En(signName)
        : getStep4Es(signName)
    },
    // Step 5 (Day 12): Urgency + offer
    5: {
      subject: isEn
        ? '✦ Your complete birth chart is waiting — special offer inside'
        : '✦ Tu carta natal completa te espera — oferta especial',
      body: isEn
        ? getStep5En(signName)
        : getStep5Es(signName)
    }
  };

  if (!emails[step]) return null;

  return {
    subject: emails[step].subject,
    html: wrapEmailHtml(emails[step].body, isEn)
  };
}

// ═══════════════════════════════════════════════════════════
// STEP 2 — Day 2: Chronobiology + sign personality
// ═══════════════════════════════════════════════════════════

function getStep2Es(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">Hola de nuevo, ' + sign + '.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Hace dos d\u00edas te envi\u00e9 tu lectura express. Hoy quiero compartirte algo que pocos saben: la ciencia real detr\u00e1s de tu signo.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Investigadores de la Universidad de Columbia (Jasvinder Singh, 2015) encontraron que <strong style="color:#C9A84C;">el mes de nacimiento influye en la predisposici\u00f3n a ciertas condiciones de salud</strong>, mediado por la exposici\u00f3n a luz solar durante el desarrollo prenatal. Esto afecta tus ritmos circadianos, tus niveles de vitamina D y tu temperamento base.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Tu signo solar no es solo un s\u00edmbolo. Es un indicador de las condiciones en las que tu sistema nervioso se form\u00f3.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Pero hay mucho m\u00e1s: tu luna, tu ascendente y tus casas astrol\u00f3gicas a\u00f1aden 14 capas que tu lectura express no pudo cubrir.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(240,237,228,0.4);margin:16px 0 0;">' +
    'En tu pr\u00f3ximo email te cuento qu\u00e9 revela exactamente una carta natal completa.' +
    '</p>';
}

function getStep2En(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">Hello again, ' + sign + '.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Two days ago I sent you your express reading. Today I want to share something few people know: the real science behind your sign.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Researchers at Columbia University (Jasvinder Singh, 2015) found that <strong style="color:#C9A84C;">your birth month influences predisposition to certain health conditions</strong>, mediated by sunlight exposure during prenatal development. This affects your circadian rhythms, vitamin D levels, and baseline temperament.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Your sun sign isn\'t just a symbol. It\'s an indicator of the conditions under which your nervous system formed.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'But there\'s much more: your moon, rising sign, and astrological houses add 14 layers your express reading couldn\'t cover.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(240,237,228,0.4);margin:16px 0 0;">' +
    'In your next email, I\'ll tell you exactly what a complete birth chart reveals.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 3 — Day 5: What a full birth chart reveals
// ═══════════════════════════════════════════════════════════

function getStep3Es(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">' + sign + ', hay algo que tu hor\u00f3scopo nunca te dir\u00e1.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Un hor\u00f3scopo mira solo tu sol. Una carta natal mira <strong style="color:#C9A84C;">15 dimensiones de ti</strong>:' +
    '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Sol</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">Tu identidad consciente</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Luna</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">Tu mundo emocional y necesidades profundas</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Ascendente</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">C\u00f3mo te percibe el mundo</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Venus</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">Tu forma de amar y tu relaci\u00f3n con el placer</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;">La Consulta</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);">Selene responde la pregunta que llevas dentro</td></tr>' +
    '</table>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Tu lectura express fue como ver una habitaci\u00f3n con la luz de una vela. Tu carta natal completa enciende todas las luces.' +
    '</p>';
}

function getStep3En(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">' + sign + ', there\'s something your horoscope will never tell you.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'A horoscope only looks at your sun. A birth chart examines <strong style="color:#C9A84C;">15 dimensions of you</strong>:' +
    '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Sun</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">Your conscious identity</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Moon</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">Your emotional world and deep needs</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Rising</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">How the world perceives you</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);">Venus</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);">How you love and relate to pleasure</td></tr>' +
    '<tr><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;">The Consultation</td><td style="padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);">Selene answers the question you carry inside</td></tr>' +
    '</table>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Your express reading was like seeing a room by candlelight. Your full birth chart turns on every light.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 4 — Day 8: Rising sign + social proof
// ═══════════════════════════════════════════════════════════

function getStep4Es(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">Una pregunta, ' + sign + '.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    '\u00bfAlguna vez has le\u00eddo la descripci\u00f3n de tu signo y has pensado <em>"esto no me representa del todo"</em>?' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'No es que la astrolog\u00eda falle. Es que <strong style="color:#C9A84C;">tu ascendente modifica profundamente c\u00f3mo expresas tu signo solar</strong>. El ascendente depende de tu hora exacta de nacimiento y determina c\u00f3mo el mundo te percibe.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'En cronobiolog\u00eda, se ha demostrado que la hora del d\u00eda en que naces afecta tu cronotipo (Roenneberg et al., 2007). Los nacidos de madrugada tienden a ser m\u00e1s matutinos; los nacidos de noche, m\u00e1s vespertinos. Tu ascendente codifica esto.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Tu carta natal completa calcula tu ascendente exacto y te muestra c\u00f3mo interact\u00faa con tu sol y tu luna. Es la pieza que falta.' +
    '</p>';
}

function getStep4En(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">A question, ' + sign + '.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Have you ever read your sign\'s description and thought <em>"this doesn\'t fully represent me"</em>?' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'It\'s not that astrology fails. It\'s that <strong style="color:#C9A84C;">your rising sign profoundly modifies how you express your sun sign</strong>. Your rising sign depends on your exact birth time and determines how the world perceives you.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'In chronobiology, research shows that the time of day you\'re born affects your chronotype (Roenneberg et al., 2007). Those born at dawn tend to be morning types; those born at night, evening types. Your rising sign encodes this.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Your complete birth chart calculates your exact rising sign and shows how it interacts with your sun and moon. It\'s the missing piece.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 5 — Day 12: Urgency + special offer
// ═══════════════════════════════════════════════════════════

function getStep5Es(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">' + sign + ', tu carta natal te est\u00e1 esperando.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Durante estos d\u00edas te he contado lo que la ciencia dice sobre tu signo, qu\u00e9 revela una carta natal completa y por qu\u00e9 tu ascendente es la pieza que falta.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Ahora es tu momento. Tu carta natal completa incluye <strong style="color:#C9A84C;">15 secciones personalizadas</strong> y algo que ning\u00fan otro servicio ofrece: <strong style="color:#C9A84C;">La Consulta</strong>, donde Selene responde la pregunta que llevas dentro.' +
    '</p>' +
    '<div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:20px;margin:16px 0;text-align:center;">' +
    '<p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.5);margin:0 0 4px;text-decoration:line-through;">Precio habitual: 47 \u20ac</p>' +
    '<p style="font-family:Georgia,serif;font-size:24px;color:#C9A84C;margin:0 0 8px;font-weight:600;">27 \u20ac</p>' +
    '<p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,237,228,0.5);margin:0;">Oferta de bienvenida \u2014 solo por email</p>' +
    '</div>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'No es una suscripci\u00f3n. Es tu carta, para siempre. Generada en el momento, \u00fanica para ti.' +
    '</p>';
}

function getStep5En(sign) {
  return '<p style="font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;">' + sign + ', your birth chart is waiting.</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Over these past days I\'ve shared the science behind your sign, what a complete birth chart reveals, and why your rising sign is the missing piece.' +
    '</p>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'Now it\'s your moment. Your complete birth chart includes <strong style="color:#C9A84C;">15 personalized sections</strong> and something no other service offers: <strong style="color:#C9A84C;">The Consultation</strong>, where Selene answers the question you carry inside.' +
    '</p>' +
    '<div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:20px;margin:16px 0;text-align:center;">' +
    '<p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.5);margin:0 0 4px;text-decoration:line-through;">Regular price: \u20ac47</p>' +
    '<p style="font-family:Georgia,serif;font-size:24px;color:#C9A84C;margin:0 0 8px;font-weight:600;">\u20ac27</p>' +
    '<p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,237,228,0.5);margin:0;">Welcome offer \u2014 email exclusive</p>' +
    '</div>' +
    '<p style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;">' +
    'No subscription. It\'s your chart, forever. Generated in the moment, unique to you.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// EMAIL HTML WRAPPER — matches Selene brand
// ═══════════════════════════════════════════════════════════

function wrapEmailHtml(bodyContent, isEn) {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background-color:#0A0A0F;font-family:Georgia,serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0F;">' +
    '<tr><td align="center" style="padding:40px 20px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
    // Header
    '<tr><td align="center" style="padding:32px 0 24px;">' +
    '<p style="font-family:Georgia,serif;font-size:24px;letter-spacing:6px;color:#C9A84C;margin:0;">S E L E N E</p>' +
    '<p style="font-family:Georgia,serif;font-size:12px;font-style:italic;color:rgba(240,237,228,0.4);margin:8px 0 0;letter-spacing:1px;">' +
    (isEn ? 'Science and awareness of the invisible' : 'Ciencia y consciencia de lo invisible') + '</p>' +
    '</td></tr>' +
    // Divider
    '<tr><td align="center" style="padding:0 40px;">' +
    '<div style="height:1px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);max-width:200px;margin:0 auto;"></div>' +
    '</td></tr>' +
    // Body
    '<tr><td style="padding:28px 32px;">' +
    bodyContent +
    '</td></tr>' +
    // CTA Button
    '<tr><td align="center" style="padding:8px 32px 28px;">' +
    '<a href="https://carta.selenaura.com" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#C9A84C,#D4AF37);color:#0A0A0F;border-radius:50px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">' +
    (isEn ? 'See my complete birth chart \u2192' : 'Ver mi carta natal completa \u2192') +
    '</a>' +
    '</td></tr>' +
    // Footer divider
    '<tr><td align="center" style="padding:0 40px;">' +
    '<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.3),transparent);max-width:300px;margin:0 auto;"></div>' +
    '</td></tr>' +
    // Footer
    '<tr><td align="center" style="padding:32px 20px 16px;">' +
    '<p style="font-family:Georgia,serif;font-size:20px;letter-spacing:5px;color:rgba(201,168,76,0.4);margin:0 0 12px;">\u2726</p>' +
    '<p style="font-size:11px;color:rgba(240,237,228,0.25);line-height:1.7;margin:0;">' +
    (isEn
      ? 'You received this email because you requested a reading at selenaura.com<br>If you no longer wish to receive emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">unsubscribe here</a>.'
      : 'Recibes este email porque solicitaste una lectura en selenaura.com<br>Si no deseas recibir m\u00e1s emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">date de baja aqu\u00ed</a>.') +
    '</p>' +
    '<p style="font-size:10px;color:rgba(240,237,228,0.15);margin:12px 0 0;">\u00a9 2026 Selene \u00b7 selenaura.com</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

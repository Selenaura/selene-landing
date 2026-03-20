// Weekly Horoscope — Cron endpoint that generates and sends personalized horoscopes
// Triggered by Vercel Cron every Monday at 6AM UTC (8AM Spain): GET /api/weekly-horoscope
// Reads contacts from Brevo list 2 with SIGNO_SOLAR, generates horoscopes via Claude Haiku,
// sends individualized emails, tracks in Supabase funnel_events.

var SIGNS = [
  'Aries', 'Tauro', 'Géminis', 'Cáncer', 'Leo', 'Virgo',
  'Libra', 'Escorpio', 'Sagitario', 'Capricornio', 'Acuario', 'Piscis'
];

var DAILY_LIMIT = 300;

var SUBJECTS = [
  function (sign) { return 'Tu semana, ' + sign + ' — lo que vi para ti'; },
  function (sign) { return 'Las estrellas hablan, ' + sign; },
  function (sign) { return 'Esta semana para ' + sign; }
];

var CTA_CONFIG = [
  { url: 'https://carta.selenaura.com', text: 'Descubre tu carta natal completa \u2192' },
  { url: 'https://tarot.selenaura.com', text: 'Tu tirada de tarot semanal \u2192' },
  { url: 'https://quiro.selenaura.com', text: 'Lee lo que dicen tus manos \u2192' },
  null // Week 4: pure value, no CTA
];

// Style constants (matching existing SelenaUra email theme)
var P_GOLD = 'font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;';
var P_BODY = 'font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;';
var P_ITALIC = 'font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(240,237,228,0.4);margin:16px 0 0;';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var BREVO_KEY = process.env.BREVO_API_KEY;
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!BREVO_KEY || !ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  try {
    var now = new Date();
    var weekOfYear = getWeekOfYear(now);
    var mondayDate = getMondayDate(now);
    var subjectIndex = weekOfYear % SUBJECTS.length;
    var ctaIndex = weekOfYear % CTA_CONFIG.length;
    var cta = CTA_CONFIG[ctaIndex];

    console.log('Weekly horoscope: week ' + weekOfYear + ', subject variant ' + subjectIndex + ', CTA variant ' + ctaIndex);

    // ═══ STEP 1: Generate horoscopes for all 12 signs via Claude Haiku ═══
    var horoscopes = await generateAllHoroscopes(ANTHROPIC_KEY, mondayDate);
    console.log('Generated horoscopes for ' + Object.keys(horoscopes).length + ' signs');

    // ═══ STEP 2: Fetch contacts from Brevo list 2 with SIGNO_SOLAR ═══
    var contacts = await fetchBrevoContacts(BREVO_KEY);
    console.log('Fetched ' + contacts.length + ' contacts with SIGNO_SOLAR');

    if (contacts.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No contacts with SIGNO_SOLAR found' });
    }

    // ═══ STEP 3: Respect 300/day limit ═══
    var toSend = contacts.slice(0, DAILY_LIMIT);
    var queued = contacts.length - toSend.length;

    // ═══ STEP 4: Send individualized emails ═══
    var sentCount = 0;
    var errors = [];

    for (var i = 0; i < toSend.length; i++) {
      var contact = toSend[i];
      var sign = contact.sign;
      var horoscope = horoscopes[sign];

      if (!horoscope) {
        console.log('No horoscope for sign: ' + sign + ', skipping ' + contact.email);
        continue;
      }

      try {
        var subject = SUBJECTS[subjectIndex](sign);
        var html = buildHoroscopeEmail(sign, horoscope, cta);

        var sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': BREVO_KEY
          },
          body: JSON.stringify({
            sender: { name: 'Selene', email: 'selene@selenaura.com' },
            to: [{ email: contact.email }],
            subject: subject,
            htmlContent: html
          })
        });

        if (!sendRes.ok) {
          var errBody = await sendRes.text();
          console.error('Brevo send error for ' + contact.email + ':', errBody);
          errors.push({ email: contact.email, error: errBody });
          continue;
        }

        // Track in Supabase
        await fetch(SUPABASE_URL + '/rest/v1/funnel_events', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            event_type: 'weekly_horoscope',
            signo_solar: sign,
            email: contact.email
          })
        });

        sentCount++;
        if (sentCount % 50 === 0) {
          console.log('Sent ' + sentCount + '/' + toSend.length + ' horoscope emails');
        }
      } catch (err) {
        errors.push({ email: contact.email, error: err.message });
        console.error('Failed to send to ' + contact.email + ':', err.message);
      }
    }

    console.log('Weekly horoscope complete: sent=' + sentCount + ', errors=' + errors.length + ', queued=' + queued);

    return res.status(200).json({
      sent: sentCount,
      errors: errors.length,
      queued: queued,
      week: weekOfYear,
      details: errors.length > 0 ? errors.slice(0, 10) : undefined
    });
  } catch (err) {
    console.error('Weekly horoscope error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// GENERATE HOROSCOPES — One Claude Haiku call per sign
// ═══════════════════════════════════════════════════════════

async function generateAllHoroscopes(apiKey, mondayDate) {
  var horoscopes = {};

  for (var i = 0; i < SIGNS.length; i++) {
    var sign = SIGNS[i];
    try {
      var response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 300,
          system: 'Eres Selene, astróloga. Genera horóscopos semanales breves (3-4 frases). Incluye un dato de cronobiología real. Nunca menciones IA. Tutea siempre. Sé específica, nunca genérica.',
          messages: [
            {
              role: 'user',
              content: 'Horóscopo semanal para ' + sign + '. Semana del ' + mondayDate + '. Máximo 4 frases.'
            }
          ]
        })
      });

      if (!response.ok) {
        var errText = await response.text();
        console.error('Claude error for ' + sign + ':', errText);
        horoscopes[sign] = 'Las estrellas guardan silencio esta semana para ti, ' + sign + '. Pero recuerda: el silencio también es un mensaje. Escúchate.';
        continue;
      }

      var data = await response.json();
      horoscopes[sign] = data.content[0].text;
    } catch (err) {
      console.error('Error generating horoscope for ' + sign + ':', err.message);
      horoscopes[sign] = 'Las estrellas guardan silencio esta semana para ti, ' + sign + '. Pero recuerda: el silencio también es un mensaje. Escúchate.';
    }
  }

  return horoscopes;
}

// ═══════════════════════════════════════════════════════════
// FETCH CONTACTS — Brevo list 2, paginated, with SIGNO_SOLAR
// ═══════════════════════════════════════════════════════════

async function fetchBrevoContacts(brevoKey) {
  var contacts = [];
  var limit = 50;
  var offset = 0;
  var hasMore = true;

  while (hasMore) {
    var url = 'https://api.brevo.com/v3/contacts/lists/2/contacts?limit=' + limit + '&offset=' + offset + '&sort=desc';
    var res = await fetch(url, {
      headers: {
        'api-key': brevoKey,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      console.error('Brevo contacts fetch error at offset ' + offset + ':', await res.text());
      break;
    }

    var data = await res.json();
    var batch = data.contacts || [];

    for (var i = 0; i < batch.length; i++) {
      var c = batch[i];
      var sign = c.attributes && c.attributes.SIGNO_SOLAR;
      if (sign && SIGNS.indexOf(sign) !== -1) {
        contacts.push({ email: c.email, sign: sign });
      }
    }

    offset += limit;
    hasMore = batch.length === limit;
  }

  return contacts;
}

// ═══════════════════════════════════════════════════════════
// EMAIL HTML BUILDER
// ═══════════════════════════════════════════════════════════

function buildHoroscopeEmail(sign, horoscope, cta) {
  var bodyContent =
    '<p style="' + P_GOLD + '">Tu semana, ' + sign + '.</p>' +
    '<p style="' + P_BODY + '">' + escapeHtml(horoscope) + '</p>' +
    '<p style="' + P_ITALIC + '">Selene</p>';

  if (cta) {
    return wrapEmailWithCta(bodyContent, cta.url, cta.text);
  }
  return wrapEmailNoLinks(bodyContent);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function wrapEmailNoLinks(bodyContent) {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background-color:#0A0A0F;font-family:Georgia,serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0F;">' +
    '<tr><td align="center" style="padding:40px 20px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
    '<tr><td align="center" style="padding:32px 0 24px;">' +
    '<p style="font-family:Georgia,serif;font-size:24px;letter-spacing:6px;color:#C9A84C;margin:0;">S E L E N E</p>' +
    '<p style="font-family:Georgia,serif;font-size:12px;font-style:italic;color:rgba(240,237,228,0.4);margin:8px 0 0;letter-spacing:1px;">Tu hor\u00f3scopo semanal</p>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:0 40px;">' +
    '<div style="height:1px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);max-width:200px;margin:0 auto;"></div>' +
    '</td></tr>' +
    '<tr><td style="padding:28px 32px;">' +
    bodyContent +
    '</td></tr>' +
    '<tr><td align="center" style="padding:32px 20px 16px;">' +
    '<p style="font-family:Georgia,serif;font-size:20px;letter-spacing:5px;color:rgba(201,168,76,0.4);margin:0 0 12px;">\u2726</p>' +
    '<p style="font-size:11px;color:rgba(240,237,228,0.25);line-height:1.7;margin:0;">' +
    'Recibes este email porque solicitaste una lectura en selenaura.com<br>Si no deseas recibir m\u00e1s emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">date de baja aqu\u00ed</a>.' +
    '</p>' +
    '<p style="font-size:10px;color:rgba(240,237,228,0.15);margin:12px 0 0;">\u00a9 2026 Selene \u00b7 selenaura.com</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function wrapEmailWithCta(bodyContent, ctaUrl, ctaText) {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background-color:#0A0A0F;font-family:Georgia,serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0F;">' +
    '<tr><td align="center" style="padding:40px 20px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
    '<tr><td align="center" style="padding:32px 0 24px;">' +
    '<p style="font-family:Georgia,serif;font-size:24px;letter-spacing:6px;color:#C9A84C;margin:0;">S E L E N E</p>' +
    '<p style="font-family:Georgia,serif;font-size:12px;font-style:italic;color:rgba(240,237,228,0.4);margin:8px 0 0;letter-spacing:1px;">Tu hor\u00f3scopo semanal</p>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:0 40px;">' +
    '<div style="height:1px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);max-width:200px;margin:0 auto;"></div>' +
    '</td></tr>' +
    '<tr><td style="padding:28px 32px;">' +
    bodyContent +
    '</td></tr>' +
    '<tr><td align="center" style="padding:8px 32px 28px;">' +
    '<a href="' + ctaUrl + '" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#C9A84C,#D4AF37);color:#0A0A0F;border-radius:50px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">' +
    ctaText +
    '</a>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:0 40px;">' +
    '<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.3),transparent);max-width:300px;margin:0 auto;"></div>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:32px 20px 16px;">' +
    '<p style="font-family:Georgia,serif;font-size:20px;letter-spacing:5px;color:rgba(201,168,76,0.4);margin:0 0 12px;">\u2726</p>' +
    '<p style="font-size:11px;color:rgba(240,237,228,0.25);line-height:1.7;margin:0;">' +
    'Recibes este email porque solicitaste una lectura en selenaura.com<br>Si no deseas recibir m\u00e1s emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">date de baja aqu\u00ed</a>.' +
    '</p>' +
    '<p style="font-size:10px;color:rgba(240,237,228,0.15);margin:12px 0 0;">\u00a9 2026 Selene \u00b7 selenaura.com</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function getWeekOfYear(date) {
  var start = new Date(date.getFullYear(), 0, 1);
  var diff = date - start;
  var oneWeek = 604800000;
  return Math.floor(diff / oneWeek);
}

function getMondayDate(date) {
  var d = new Date(date);
  var day = d.getDay();
  var diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  var months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return d.getDate() + ' de ' + months[d.getMonth()] + ' de ' + d.getFullYear();
}

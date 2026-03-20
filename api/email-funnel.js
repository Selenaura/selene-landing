// Email Funnel — Cron endpoint that sends scheduled nurturing emails
// Triggered by Vercel Cron every 2 hours: GET /api/email-funnel
// REDESIGNED: Based on CHANI, Co-Star, and wellness email best practices

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== 'Bearer ' + cronSecret) {
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
    var skipped = 0;
    var errors = [];

    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      try {
        // ═══ CHECK HA_COMPRADO for sales emails (steps 5, 6) ═══
        if (item.step >= 5 && item.step <= 6) {
          var hasBought = await checkHaComprado(BREVO_KEY, item.email);
          if (hasBought) {
            await markSent(SUPABASE_URL, SUPABASE_KEY, item.id);
            skipped++;
            console.log('Skipped step ' + item.step + ' for ' + item.email + ' (already purchased)');
            continue;
          }
        }

        var emailContent = getEmailContent(item.step, item.signo_solar, item.signo_en, item.lang);
        if (!emailContent) {
          await markSent(SUPABASE_URL, SUPABASE_KEY, item.id);
          continue;
        }

        // Send via Brevo
        var sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': BREVO_KEY
          },
          body: JSON.stringify({
            sender: { name: 'Selene', email: 'selene@selenaura.com' },
            to: [{ email: item.email }],
            subject: emailContent.subject,
            htmlContent: emailContent.html
          })
        });

        if (!sendRes.ok) {
          var errBody = await sendRes.text();
          console.error('Brevo send error step ' + item.step + ':', errBody);
        }

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
        console.error('Failed step ' + item.step + ' to ' + item.email + ':', err.message);
      }
    }

    return res.status(200).json({ sent: sentCount, skipped: skipped, errors: errors.length, details: errors });
  } catch (err) {
    console.error('Email funnel error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// CHECK IF CONTACT HAS PURCHASED (Brevo attribute)
// ═══════════════════════════════════════════════════════════

async function checkHaComprado(brevoKey, email) {
  try {
    var res = await fetch('https://api.brevo.com/v3/contacts/' + encodeURIComponent(email), {
      headers: { 'api-key': brevoKey, 'Accept': 'application/json' }
    });
    if (!res.ok) return false;
    var contact = await res.json();
    return contact.attributes && contact.attributes.HA_COMPRADO === true;
  } catch (e) {
    console.error('checkHaComprado error:', e.message);
    return false;
  }
}

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
// EMAIL CONTENT — 7-step nurture + post-purchase
// ═══════════════════════════════════════════════════════════
// Step 2 (Day 3): Science — ZERO links, invite reply
// Step 3 (Day 7): Birth chart — soft mention, ONE link
// Step 4 (Day 10): Rising sign + free cross-sell (Tarot/Quiro)
// Step 5 (Day 14): First sell — Carta 27€ [CHECK HA_COMPRADO]
// Step 6 (Day 21): Last chance — Pack anchor [CHECK HA_COMPRADO]
// Step 10 (+1h): Post-purchase thanks
// Step 11 (+3d): Ask for testimonial
// Step 12 (+7d): Cross-sell
// Step 20 (RE1): Re-engagement — soft check-in (no links)
// Step 21 (RE2): Re-engagement — value + free horoscope CTA
// Step 22 (RE3): Re-engagement — farewell + opt-in CTA
// ═══════════════════════════════════════════════════════════

function getEmailContent(step, sign, signEn, lang) {
  var isEn = lang === 'en';
  var signName = isEn ? (signEn || sign) : (sign || signEn);

  var emails = {
    2: {
      subject: isEn
        ? signName + ', what Columbia University found about your birth month'
        : signName + ', lo que Columbia descubri\u00f3 sobre tu mes de nacimiento',
      body: isEn ? getStep2En(signName) : getStep2Es(signName),
      showCta: false
    },
    3: {
      subject: isEn
        ? 'What your horoscope will never tell you'
        : 'Lo que tu hor\u00f3scopo nunca te dir\u00e1',
      body: isEn ? getStep3En(signName) : getStep3Es(signName),
      showCta: true,
      ctaUrl: 'https://carta.selenaura.com',
      ctaText: isEn ? 'See what your chart says \u2192' : 'Ver qu\u00e9 dice tu carta \u2192'
    },
    4: {
      subject: isEn
        ? 'Your rising sign changes everything, ' + signName
        : 'Tu ascendente lo cambia todo, ' + signName,
      body: isEn ? getStep4En(signName) : getStep4Es(signName),
      showCta: true,
      ctaUrl: 'https://tarot.selenaura.com',
      ctaText: isEn ? 'Try your free tarot reading \u2192' : 'Prueba tu tirada de tarot gratis \u2192'
    },
    5: {
      subject: isEn
        ? 'There\u2019s something in your chart I didn\u2019t tell you'
        : 'Hay algo en tu carta que no te cont\u00e9',
      body: isEn ? getStep5En(signName) : getStep5Es(signName),
      showCta: true,
      ctaUrl: 'https://carta.selenaura.com',
      ctaText: isEn ? 'See my complete birth chart \u2192' : 'Ver mi carta natal completa \u2192'
    },
    6: {
      subject: isEn
        ? signName + ', this is the last time I\u2019ll write about your chart'
        : signName + ', es la \u00faltima vez que te escribo sobre tu carta',
      body: isEn ? getStep6En(signName) : getStep6Es(signName),
      showCta: true,
      ctaUrl: 'https://carta.selenaura.com',
      ctaText: isEn ? 'My birth chart \u2192' : 'Mi carta natal \u2192'
    },
    10: {
      subject: isEn
        ? 'Your reading is ready \u2014 take your time with it'
        : 'Tu lectura est\u00e1 lista \u2014 l\u00e9ela con calma',
      body: isEn ? getPostPurchase1En(signName) : getPostPurchase1Es(signName),
      showCta: false
    },
    11: {
      subject: isEn
        ? 'What resonated most with you?'
        : '\u00bfQu\u00e9 fue lo que m\u00e1s te reson\u00f3?',
      body: isEn ? getPostPurchase2En(signName) : getPostPurchase2Es(signName),
      showCta: false
    },
    12: {
      subject: isEn
        ? 'I saw something else in your chart...'
        : 'Vi algo m\u00e1s en tu carta...',
      body: isEn ? getPostPurchase3En(signName) : getPostPurchase3Es(signName),
      showCta: true,
      ctaUrl: 'https://tarot.selenaura.com',
      ctaText: isEn ? 'Try your free tarot reading \u2192' : 'Hacer mi tirada de tarot gratis \u2192'
    },
    20: {
      subject: isEn
        ? 'Still there, ' + signName + '?'
        : '\u00bfSigues ah\u00ed, ' + signName + '?',
      body: isEn ? getStep20En(signName) : getStep20Es(signName),
      showCta: false
    },
    21: {
      subject: isEn
        ? 'Your sky has changed, ' + signName
        : 'Tu cielo ha cambiado, ' + signName,
      body: isEn ? getStep21En(signName) : getStep21Es(signName),
      showCta: true,
      ctaUrl: 'https://selenaura.com',
      ctaText: isEn ? 'See your updated horoscope \u2192' : 'Ver tu hor\u00f3scopo actualizado \u2192'
    },
    22: {
      subject: isEn
        ? 'Last message, ' + signName + ' \u2014 unless you want to stay'
        : '\u00daltimo mensaje, ' + signName + ' \u2014 a menos que quieras quedarte',
      body: isEn ? getStep22En(signName) : getStep22Es(signName),
      showCta: true,
      ctaUrl: 'https://selenaura.com',
      ctaText: isEn ? 'I want to keep receiving \u2192' : 'Quiero seguir recibiendo \u2192'
    }
  };

  if (!emails[step]) return null;
  var e = emails[step];

  return {
    subject: e.subject,
    html: e.showCta
      ? wrapEmailWithCta(e.body, isEn, e.ctaUrl, e.ctaText)
      : wrapEmailNoLinks(e.body, isEn)
  };
}

// ═══════════════════════════════════════════════════════════
// STEP 2 — Day 3: Science + invite reply (ZERO links)
// ═══════════════════════════════════════════════════════════

function getStep2Es(sign) {
  return '<p style="' + P_GOLD + '">Hola de nuevo, ' + sign + '.</p>' +
    '<p style="' + P_BODY + '">' +
    'Hace unos d\u00edas te envi\u00e9 tu lectura express. Hoy quiero compartirte algo que pocos saben: la ciencia real detr\u00e1s de tu signo.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Investigadores de la Universidad de Columbia (Jasvinder Singh, 2015) encontraron que <strong style="color:#C9A84C;">el mes de nacimiento influye en la predisposici\u00f3n a ciertas condiciones de salud</strong>, mediado por la exposici\u00f3n a luz solar durante el desarrollo prenatal.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Tu signo solar no es solo un s\u00edmbolo. Es un indicador de las condiciones en las que tu sistema nervioso se form\u00f3.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Pero hay mucho m\u00e1s: tu luna, tu ascendente y tus casas astrol\u00f3gicas a\u00f1aden 14 capas que tu lectura express no pudo cubrir.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    '\u00bfTe identific\u00f3 algo de lo que le\u00edste en tu lectura? Me encantar\u00eda saberlo \u2014 solo responde a este email.' +
    '</p>';
}

function getStep2En(sign) {
  return '<p style="' + P_GOLD + '">Hello again, ' + sign + '.</p>' +
    '<p style="' + P_BODY + '">' +
    'A few days ago I sent you your express reading. Today I want to share something few people know: the real science behind your sign.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Researchers at Columbia University (Jasvinder Singh, 2015) found that <strong style="color:#C9A84C;">your birth month influences predisposition to certain health conditions</strong>, mediated by sunlight exposure during prenatal development.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Your sun sign isn\'t just a symbol. It\'s an indicator of the conditions under which your nervous system formed.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'But there\'s much more: your moon, rising sign, and astrological houses add 14 layers your express reading couldn\'t cover.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Did anything in your reading resonate? I\'d love to know \u2014 just reply to this email.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 3 — Day 7: What a birth chart reveals (soft CTA)
// ═══════════════════════════════════════════════════════════

function getStep3Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ', hay algo que tu hor\u00f3scopo nunca te dir\u00e1.</p>' +
    '<p style="' + P_BODY + '">' +
    'Un hor\u00f3scopo mira solo tu sol. Una carta natal mira <strong style="color:#C9A84C;">15 dimensiones de ti</strong>:' +
    '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">' +
    '<tr><td style="' + TD_GOLD + '">Sol</td><td style="' + TD_BODY + '">Tu identidad consciente</td></tr>' +
    '<tr><td style="' + TD_GOLD + '">Luna</td><td style="' + TD_BODY + '">Tu mundo emocional y necesidades profundas</td></tr>' +
    '<tr><td style="' + TD_GOLD + '">Ascendente</td><td style="' + TD_BODY + '">C\u00f3mo te percibe el mundo</td></tr>' +
    '<tr><td style="' + TD_GOLD + '">Venus</td><td style="' + TD_BODY + '">Tu forma de amar y relacionarte</td></tr>' +
    '<tr><td style="' + TD_GOLD_LAST + '">La Consulta</td><td style="' + TD_BODY_LAST + '">Selene responde la pregunta que llevas dentro</td></tr>' +
    '</table>' +
    '<p style="' + P_BODY + '">' +
    'Tu lectura express fue como ver una habitaci\u00f3n con la luz de una vela. Tu carta natal completa enciende todas las luces.' +
    '</p>';
}

function getStep3En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ', there\'s something your horoscope will never tell you.</p>' +
    '<p style="' + P_BODY + '">' +
    'A horoscope only looks at your sun. A birth chart examines <strong style="color:#C9A84C;">15 dimensions of you</strong>:' +
    '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">' +
    '<tr><td style="' + TD_GOLD + '">Sun</td><td style="' + TD_BODY + '">Your conscious identity</td></tr>' +
    '<tr><td style="' + TD_GOLD + '">Moon</td><td style="' + TD_BODY + '">Your emotional world and deep needs</td></tr>' +
    '<tr><td style="' + TD_GOLD + '">Rising</td><td style="' + TD_BODY + '">How the world perceives you</td></tr>' +
    '<tr><td style="' + TD_GOLD + '">Venus</td><td style="' + TD_BODY + '">How you love and relate</td></tr>' +
    '<tr><td style="' + TD_GOLD_LAST + '">The Consultation</td><td style="' + TD_BODY_LAST + '">Selene answers the question you carry inside</td></tr>' +
    '</table>' +
    '<p style="' + P_BODY + '">' +
    'Your express reading was like seeing a room by candlelight. Your full birth chart turns on every light.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 4 — Day 10: Rising sign + free cross-sell
// ═══════════════════════════════════════════════════════════

function getStep4Es(sign) {
  return '<p style="' + P_GOLD + '">Una pregunta, ' + sign + '.</p>' +
    '<p style="' + P_BODY + '">' +
    '\u00bfAlguna vez has le\u00eddo la descripci\u00f3n de tu signo y has pensado <em>"esto no me representa del todo"</em>?' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'No es que la astrolog\u00eda falle. Es que <strong style="color:#C9A84C;">tu ascendente modifica profundamente c\u00f3mo expresas tu signo solar</strong>. Depende de tu hora exacta de nacimiento.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'En cronobiolog\u00eda, se ha demostrado que la hora en que naces afecta tu cronotipo (Roenneberg et al., 2007). Tu ascendente codifica esto.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Y hablando de descubrirte: \u00bfsab\u00edas que tus manos tambi\u00e9n hablan? La quirolog\u00eda analiza los patrones de tus l\u00edneas, y lo que encuentras puede sorprenderte. Es gratis.' +
    '</p>';
}

function getStep4En(sign) {
  return '<p style="' + P_GOLD + '">A question, ' + sign + '.</p>' +
    '<p style="' + P_BODY + '">' +
    'Have you ever read your sign\'s description and thought <em>"this doesn\'t fully represent me"</em>?' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'It\'s not that astrology fails. It\'s that <strong style="color:#C9A84C;">your rising sign profoundly modifies how you express your sun sign</strong>. It depends on your exact birth time.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'In chronobiology, research shows the time you\'re born affects your chronotype (Roenneberg et al., 2007). Your rising sign encodes this.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'And speaking of self-discovery: did you know your hands speak too? Palmistry analyzes the patterns in your lines, and what you find may surprise you. It\'s free.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 5 — Day 14: First sell (CHECK HA_COMPRADO)
// ═══════════════════════════════════════════════════════════

function getStep5Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Cuando le\u00ed tu cielo natal hace dos semanas, te cont\u00e9 lo que pude en tres p\u00e1rrafos.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Pero tu carta tiene 15 secciones \u2014 y hay una que no dej\u00e9 de pensar: <strong style="color:#C9A84C;">tu Luna dice algo sobre c\u00f3mo amas que mereces saber</strong>.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Tu carta completa incluye:<br>' +
    '\u2014 Sol, Luna y Ascendente en profundidad<br>' +
    '\u2014 Las 12 casas astrol\u00f3gicas de tu cielo<br>' +
    '\u2014 La Consulta: donde te respondo la pregunta que llevas dentro' +
    '</p>' +
    '<div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:20px;margin:16px 0;text-align:center;">' +
    '<p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.5);margin:0 0 4px;text-decoration:line-through;">Precio habitual: 44,99 \u20ac</p>' +
    '<p style="font-family:Georgia,serif;font-size:24px;color:#C9A84C;margin:0 0 8px;font-weight:600;">27 \u20ac</p>' +
    '<p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,237,228,0.5);margin:0;">Oferta de bienvenida \u2014 solo por email</p>' +
    '</div>' +
    '<p style="' + P_BODY + '">' +
    sign + ', son 27 \u20ac. Menos que un caf\u00e9 a la semana. No es una suscripci\u00f3n. Es tu carta, para siempre.' +
    '</p>';
}

function getStep5En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'When I read your natal sky two weeks ago, I told you what I could in three paragraphs.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'But your chart has 15 sections \u2014 and there\'s one I couldn\'t stop thinking about: <strong style="color:#C9A84C;">your Moon says something about how you love that you deserve to know</strong>.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Your complete chart includes:<br>' +
    '\u2014 Sun, Moon and Rising in depth<br>' +
    '\u2014 All 12 astrological houses<br>' +
    '\u2014 The Consultation: where I answer the question you carry inside' +
    '</p>' +
    '<div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:20px;margin:16px 0;text-align:center;">' +
    '<p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.5);margin:0 0 4px;text-decoration:line-through;">Regular price: \u20ac44.99</p>' +
    '<p style="font-family:Georgia,serif;font-size:24px;color:#C9A84C;margin:0 0 8px;font-weight:600;">\u20ac27</p>' +
    '<p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,237,228,0.5);margin:0;">Welcome offer \u2014 email exclusive</p>' +
    '</div>' +
    '<p style="' + P_BODY + '">' +
    sign + ', it\'s \u20ac27. Less than a coffee a week. No subscription. Your chart, forever.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STEP 6 — Day 21: Last chance + Pack anchor (NEW)
// ═══════════════════════════════════════════════════════════

function getStep6Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Hace tres semanas le\u00ed tu cielo natal y desde entonces te he escrito cada semana sobre lo que ve\u00eda para ti.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Hoy te escribo por \u00faltima vez sobre tu carta.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Tu carta natal completa con La Consulta cuesta <strong style="color:#C9A84C;">27 \u20ac</strong> \u2014 e incluye algo que no ofrezco en ning\u00fan otro sitio: una conversaci\u00f3n donde me preguntas lo que necesites saber.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Y si quieres la experiencia completa, el <strong style="color:#C9A84C;">Pack C\u00f3smico</strong> (carta + tarot + quirolog\u00eda + consulta) est\u00e1 en 39,99 \u20ac \u2014 todo tu universo en un solo lugar.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'No voy a insistir. Si sientes que es el momento, aqu\u00ed est\u00e1. Si no, seguir\u00e9 aqui cada semana con tu hor\u00f3scopo.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getStep6En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Three weeks ago I read your natal sky and since then I\'ve written to you every week about what I saw for you.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Today I write about your chart for the last time.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Your complete birth chart with The Consultation costs <strong style="color:#C9A84C;">\u20ac27</strong> \u2014 and includes something I don\'t offer anywhere else: a conversation where you ask me whatever you need to know.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'And if you want the complete experience, the <strong style="color:#C9A84C;">Cosmic Pack</strong> (chart + tarot + palmistry + consultation) is \u20ac39.99 \u2014 your entire universe in one place.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'I won\'t insist. If you feel it\'s the right time, here it is. If not, I\'ll be here every week with your horoscope.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// POST-PURCHASE EMAILS (Steps 10, 11, 12)
// ═══════════════════════════════════════════════════════════

function getPostPurchase1Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Tu lectura est\u00e1 lista. T\u00f3mate tu tiempo con ella.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'No la leas con prisa. Bu\u0301scate un momento tranquilo, pon algo de mu\u0301sica si quieres, y d\u00e9jate leer. Hay partes que te van a dar escalofr\u00edos. Otras que necesitar\u00e1s releer man\u0303ana.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Y recuerda: tienes La Consulta incluida. Cuando termines de leer, puedes preguntarme lo que necesites.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getPostPurchase1En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Your reading is ready. Take your time with it.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Don\'t read it in a rush. Find a quiet moment, put on some music if you like, and let yourself be read. There are parts that will give you chills. Others you\'ll need to reread tomorrow.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'And remember: The Consultation is included. When you finish reading, you can ask me whatever you need.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getPostPurchase2Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Han pasado unos d\u00edas desde que le\u00edste tu carta. \u00bfQu\u00e9 fue lo que m\u00e1s te reson\u00f3?' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Me encanta saber qu\u00e9 parte conecta m\u00e1s con cada persona. A veces es la Luna. Otras veces es La Consulta. Y a veces es algo que ni yo esperaba.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    '<strong style="color:#C9A84C;">Resp\u00f3ndeme a este email</strong> y cu\u00e9ntame. Tu experiencia me ayuda a seguir mejorando lo que hago.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getPostPurchase2En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'It\'s been a few days since you read your chart. What resonated most?' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'I love knowing which part connects most with each person. Sometimes it\'s the Moon. Other times it\'s The Consultation. And sometimes it\'s something even I didn\'t expect.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    '<strong style="color:#C9A84C;">Reply to this email</strong> and tell me. Your experience helps me keep improving what I do.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getPostPurchase3Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'Mientras revis\u00e9 tu carta, vi algo m\u00e1s que no cupo en las 15 secciones.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Tu carta natal habla de qui\u00e9n eres. Pero el tarot habla de <strong style="color:#C9A84C;">d\u00f3nde est\u00e1s ahora</strong> \u2014 qu\u00e9 energ\u00eda te rodea, qu\u00e9 decisi\u00f3n est\u00e1 pendiente, qu\u00e9 necesitas soltar.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Es gratis. Una carta del tarot, un ritual de respiraci\u00f3n, y una lectura que te va a sorprender.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Y si quieres ir m\u00e1s profundo, la tirada de 3 cartas cuesta menos que un caf\u00e9.' +
    '</p>';
}

function getPostPurchase3En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY + '">' +
    'While reviewing your chart, I saw something else that didn\'t fit in the 15 sections.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'Your birth chart speaks about who you are. But tarot speaks about <strong style="color:#C9A84C;">where you are right now</strong> \u2014 what energy surrounds you, what decision is pending, what you need to let go.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'It\'s free. One tarot card, a breathing ritual, and a reading that will surprise you.' +
    '</p>' +
    '<p style="' + P_BODY + '">' +
    'And if you want to go deeper, the 3-card reading costs less than a coffee.' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// RE-ENGAGEMENT EMAILS (Steps 20, 21, 22)
// ═══════════════════════════════════════════════════════════

var P_BODY_J = 'font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;text-align:justify;';

function getStep20Es(sign) {
  return '<p style="' + P_GOLD + '">Hola, ' + sign + '.</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Hace tiempo que no te escribo. El cielo ha cambiado mucho desde la \u00faltima vez.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Los planetas no se detienen: Saturno sigue su tr\u00e1nsito lento y transformador, Venus ha cruzado nuevos signos, y la Luna ha completado decenas de ciclos desde que nos le\u00edmos por \u00faltima vez.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Si ya no quieres recibir mis mensajes, lo entiendo. Pero si a\u00fan tienes curiosidad... <strong style="color:#C9A84C;">responde a este email con una sola palabra: \u201csigo\u201d</strong>.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getStep20En(sign) {
  return '<p style="' + P_GOLD + '">Hello, ' + sign + '.</p>' +
    '<p style="' + P_BODY_J + '">' +
    'It\'s been a while since I last wrote. The sky has changed a lot since then.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'The planets don\'t stop: Saturn continues its slow, transformative transit, Venus has crossed new signs, and the Moon has completed dozens of cycles since we last read together.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'If you no longer want to receive my messages, I understand. But if you\'re still curious... <strong style="color:#C9A84C;">reply to this email with one word: \u201cstay\u201d</strong>.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Selene' +
    '</p>';
}

function getStep21Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ', tu cielo ha cambiado.</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Desde la \u00faltima vez que nos conectamos, han pasado cosas importantes en el cosmos que te afectan directamente.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Los tr\u00e1nsitos planetarios de estas semanas est\u00e1n moviendo energ\u00edas en \u00e1reas clave de tu carta: relaciones, trabajo interior y decisiones que llevas posponiendo. <strong style="color:#C9A84C;">Marte y Venus est\u00e1n activando zonas de tu cielo que no puedes ignorar</strong>.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'He actualizado tu hor\u00f3scopo con lo que el cielo dice para ti ahora mismo. Es gratuito, como siempre.' +
    '</p>';
}

function getStep21En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ', your sky has changed.</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Since we last connected, important things have happened in the cosmos that directly affect you.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'The planetary transits of recent weeks are moving energy in key areas of your chart: relationships, inner work, and decisions you\'ve been postponing. <strong style="color:#C9A84C;">Mars and Venus are activating zones in your sky that you can\'t ignore</strong>.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'I\'ve updated your horoscope with what the sky says for you right now. It\'s free, as always.' +
    '</p>';
}

function getStep22Es(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Este es mi \u00faltimo email.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'He disfrutado escribirte sobre tu cielo, tus tr\u00e1nsitos y lo que las estrellas ve\u00edan para ti. Pero entiendo que las prioridades cambian, y no quiero llenar tu bandeja con algo que ya no te sirve.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'Si quieres seguir recibiendo tus actualizaciones c\u00f3smicas, simplemente <strong style="color:#C9A84C;">haz clic en el bot\u00f3n de abajo</strong>. Si no, te deseo el mejor de los cielos.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'Con cari\u00f1o estelar,<br>Selene' +
    '</p>';
}

function getStep22En(sign) {
  return '<p style="' + P_GOLD + '">' + sign + ',</p>' +
    '<p style="' + P_BODY_J + '">' +
    'This is my last email.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'I\'ve enjoyed writing to you about your sky, your transits, and what the stars saw for you. But I understand priorities change, and I don\'t want to fill your inbox with something that no longer serves you.' +
    '</p>' +
    '<p style="' + P_BODY_J + '">' +
    'If you want to keep receiving your cosmic updates, simply <strong style="color:#C9A84C;">click the button below</strong>. If not, I wish you the best of skies.' +
    '</p>' +
    '<p style="' + P_ITALIC + '">' +
    'With starlight,<br>Selene' +
    '</p>';
}

// ═══════════════════════════════════════════════════════════
// STYLE CONSTANTS
// ═══════════════════════════════════════════════════════════

var P_GOLD = 'font-family:Georgia,serif;font-size:18px;color:#C9A84C;margin:0 0 8px;font-weight:400;';
var P_BODY = 'font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;margin:0 0 16px;';
var P_ITALIC = 'font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(240,237,228,0.4);margin:16px 0 0;';
var TD_GOLD = 'padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;border-bottom:1px solid rgba(201,168,76,0.15);';
var TD_BODY = 'padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);border-bottom:1px solid rgba(201,168,76,0.15);';
var TD_GOLD_LAST = 'padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:#C9A84C;';
var TD_BODY_LAST = 'padding:8px 12px;font-family:Georgia,serif;font-size:14px;color:rgba(240,237,228,0.65);';

// ═══════════════════════════════════════════════════════════
// EMAIL WRAPPERS — Two versions: with CTA and without
// ═══════════════════════════════════════════════════════════

function wrapEmailNoLinks(bodyContent, isEn) {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background-color:#0A0A0F;font-family:Georgia,serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0F;">' +
    '<tr><td align="center" style="padding:40px 20px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
    '<tr><td align="center" style="padding:32px 0 24px;">' +
    '<p style="font-family:Georgia,serif;font-size:24px;letter-spacing:6px;color:#C9A84C;margin:0;">S E L E N E</p>' +
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
    (isEn
      ? 'You received this email because you requested a reading at selenaura.com<br>If you no longer wish to receive emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">unsubscribe here</a>.'
      : 'Recibes este email porque solicitaste una lectura en selenaura.com<br>Si no deseas recibir m\u00e1s emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">date de baja aqu\u00ed</a>.') +
    '</p>' +
    '<p style="font-size:10px;color:rgba(240,237,228,0.15);margin:12px 0 0;">\u00a9 2026 Selene \u00b7 selenaura.com</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function wrapEmailWithCta(bodyContent, isEn, ctaUrl, ctaText) {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background-color:#0A0A0F;font-family:Georgia,serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0F;">' +
    '<tr><td align="center" style="padding:40px 20px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
    '<tr><td align="center" style="padding:32px 0 24px;">' +
    '<p style="font-family:Georgia,serif;font-size:24px;letter-spacing:6px;color:#C9A84C;margin:0;">S E L E N E</p>' +
    '<p style="font-family:Georgia,serif;font-size:12px;font-style:italic;color:rgba(240,237,228,0.4);margin:8px 0 0;letter-spacing:1px;">' +
    (isEn ? 'Science and awareness of the invisible' : 'Ciencia y consciencia de lo invisible') + '</p>' +
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
    (isEn
      ? 'You received this email because you requested a reading at selenaura.com<br>If you no longer wish to receive emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">unsubscribe here</a>.'
      : 'Recibes este email porque solicitaste una lectura en selenaura.com<br>Si no deseas recibir m\u00e1s emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">date de baja aqu\u00ed</a>.') +
    '</p>' +
    '<p style="font-size:10px;color:rgba(240,237,228,0.15);margin:12px 0 0;">\u00a9 2026 Selene \u00b7 selenaura.com</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

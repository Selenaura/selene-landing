module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    var body = req.body || {};
    var email = body.email;
    var birthDate = body.birthDate;
    var sign = body.sign || '';
    var signEn = body.signEn || '';
    var lang = body.lang || 'es';
    var emailOnly = body.emailOnly;
    if (emailOnly && email) {
      var readingHtml = body.readingHtml || '';
      try {
        await subscribeToBrevo(email, birthDate, sign);
      } catch(e) { console.error('Brevo subscribe error:', e.message); }
      if (readingHtml) {
        try {
          await sendReadingEmail(email, sign, signEn, readingHtml, lang);
        } catch(e) { console.error('Brevo email error:', e.message); }
      }
      // Track: email capturado
      trackFunnelEvent('email_capturado', sign, email).catch(function(e) { console.error('Track error:', e.message); });
      return res.status(200).json({ subscribed: true });
    }
    if (!birthDate || !sign) {
      return res.status(400).json({ error: 'Missing birthDate or sign' });
    }
    var reading = await generateReading(birthDate, sign, signEn, lang);
    if (email) {
      try { await subscribeToBrevo(email, birthDate, sign); } catch(e) { console.error('Brevo error:', e.message); }
      // Track: email capturado (email given with reading)
      trackFunnelEvent('email_capturado', sign, email).catch(function(e) { console.error('Track error:', e.message); });
    }
    // Track: lectura generada
    await trackFunnelEvent('lectura_generada', sign, email || null).catch(function(e) { console.error('Track error:', e.message); });
    return res.status(200).json({ reading: reading, sign: sign, signEn: signEn });
  } catch (err) {
    console.error('Lectura Express error:', err);
    return res.status(500).json({ error: 'Error generating reading', detail: err.message });
  }
};
async function generateReading(birthDate, sign, signEn, lang) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  var date = new Date(birthDate + 'T12:00:00Z');
  var month = date.getUTCMonth();
  var season = month >= 2 && month <= 4 ? 'primavera' : month >= 5 && month <= 7 ? 'verano' : month >= 8 && month <= 10 ? 'otono' : 'invierno';
  var systemPrompt = 'Eres Selene, astrologa y guia de autoconocimiento de SelenaUra. Combinas astrologia con neurociencia y cronobiologia real. Tu voz es intima, calida, directa. Tuteas siempre. NUNCA menciones IA, inteligencia artificial, algoritmos, GPT, Claude ni tecnologia. Eres Selene.\n\nREGLAS:\n- Escribe exactamente 3 parrafos cortos (4-5 lineas cada uno)\n- Usa HTML: <p> para parrafos, <strong> para enfasis\n- Primer parrafo: personalidad del signo + dato de cronobiologia real\n- Segundo parrafo: transitos actuales y consejo practico\n- Tercer parrafo: invitacion a descubrir su carta natal completa (ascendente y luna)\n- NO uses emojis ni listas\n- Idioma: ' + (lang === 'en' ? 'ingles' : 'espanol') + '\n- Maximo 250 palabras\n- NUNCA seas generica, cada frase para ESTA persona';
  var userPrompt = 'Genera una Lectura Express para:\n- Signo solar: ' + sign + ' (' + signEn + ')\n- Fecha de nacimiento: ' + birthDate + '\n- Estacion: ' + season;
  var response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!response.ok) {
    var errText = await response.text();
    throw new Error('Claude API ' + response.status + ': ' + errText);
  }
  var data = await response.json();
  var text = '';
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') text += data.content[i].text;
  }
  return text;
}
async function subscribeToBrevo(email, birthDate, sign) {
  var brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) { console.warn('No BREVO_API_KEY'); return; }
  await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': brevoKey
    },
    body: JSON.stringify({
      email: email,
      listIds: [2],
      attributes: { SIGNO_SOLAR: sign || '', FECHA_NACIMIENTO: birthDate || '' },
      updateEnabled: true
    })
  });
}

async function sendReadingEmail(email, sign, signEn, readingHtml, lang) {
  var brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) { console.warn('No BREVO_API_KEY for email'); return; }
  
  var signName = lang === 'en' ? (signEn || sign) : (sign || signEn);
  var subject = lang === 'en' 
    ? '✦ Your cosmic reading, ' + signName
    : '✦ Tu lectura cósmica, ' + signName;
  
  var htmlContent = buildEmailHtml(readingHtml, signName, lang);
  
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': brevoKey
    },
    body: JSON.stringify({
      sender: { name: 'Selene', email: 'info@selenaura.com' },
      to: [{ email: email }],
      subject: subject,
      htmlContent: htmlContent
    })
  });
}

async function trackFunnelEvent(eventType, sign, email) {
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
      email: email || null
    })
  });
}

function buildEmailHtml(readingHtml, signName, lang) {
  var isEn = lang === 'en';
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
    '<tr><td align="center" style="padding:28px 0 8px;">' +
    '<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:6px 18px;border-radius:20px;background:rgba(201,168,76,0.12);color:#C9A84C;">' +
    (isEn ? '✦ Your Express Cosmic Reading' : '✦ Tu Lectura Cósmica Express') + '</span>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:12px 0 4px;">' +
    '<p style="font-family:Georgia,serif;font-size:26px;color:#F0EDE4;margin:0;font-weight:400;">' + signName + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 32px 28px;">' +
    '<div style="font-family:Georgia,serif;font-size:15px;color:rgba(240,237,228,0.75);line-height:1.85;text-align:justify;">' +
    readingHtml +
    '</div>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:0 40px;">' +
    '<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.3),transparent);max-width:300px;margin:0 auto;"></div>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:28px 32px;">' +
    '<p style="font-family:Georgia,serif;font-size:15px;font-style:italic;color:rgba(240,237,228,0.6);line-height:1.7;margin:0 0 20px;">' +
    (isEn 
      ? 'This is just a glimpse. Your full birth chart has 15 layers &mdash; including The Consultation, where Selene answers the question you carry inside.'
      : 'Esto es solo una muestra. Tu carta natal completa tiene 15 capas &mdash; incluida La Consulta, donde Selene responde la pregunta que llevas dentro.') +
    '</p>' +
    '<a href="https://carta.selenaura.com" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#C9A84C,#D4AF37);color:#0A0A0F;border-radius:50px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">' +
    (isEn ? 'Discover your full birth chart →' : 'Descubre tu carta natal completa →') +
    '</a>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:32px 20px 16px;">' +
    '<p style="font-family:Georgia,serif;font-size:20px;letter-spacing:5px;color:rgba(201,168,76,0.4);margin:0 0 12px;">✦</p>' +
    '<p style="font-size:11px;color:rgba(240,237,228,0.25);line-height:1.7;margin:0;">' +
    (isEn
      ? 'You received this email because you requested a reading at selenaura.com<br>If you no longer wish to receive emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">unsubscribe here</a>.'
      : 'Recibes este email porque solicitaste una lectura en selenaura.com<br>Si no deseas recibir más emails, <a href="{{unsubscribe}}" style="color:rgba(201,168,76,0.4);">date de baja aquí</a>.') +
    '</p>' +
    '<p style="font-size:10px;color:rgba(240,237,228,0.15);margin:12px 0 0;">© 2026 Selene · selenaura.com</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

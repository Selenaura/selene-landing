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
      subscribeToBrevo(email, birthDate, sign).catch(function(e) { console.error('Brevo error:', e.message); });
      return res.status(200).json({ subscribed: true });
    }
    if (!birthDate || !sign) {
      return res.status(400).json({ error: 'Missing birthDate or sign' });
    }
    var reading = await generateReading(birthDate, sign, signEn, lang);
    if (email) {
      subscribeToBrevo(email, birthDate, sign).catch(function(e) { console.error('Brevo error:', e.message); });
    }
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

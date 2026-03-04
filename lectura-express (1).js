/**
 * ═══ LECTURA CÓSMICA EXPRESS ═══
 * Vercel Serverless Function
 * 
 * Flujo:
 *   1. Recibe email + fecha nacimiento + signo + idioma
 *   2. Claude Sonnet genera lectura personalizada (~3 párrafos)
 *   3. Suscribe email en MailerLite con campos custom
 *   4. Devuelve lectura al frontend
 * 
 * Variables de entorno necesarias (Vercel → Settings → Environment Variables):
 *   ANTHROPIC_API_KEY   → tu clave de API de Anthropic
 *   MAILERLITE_API_KEY  → tu clave de API de MailerLite
 *   MAILERLITE_GROUP_ID → ID del grupo "Lectura Express" en MailerLite
 * 
 * Coste estimado: ~€0,03-0,05 por lectura (Claude Sonnet)
 */

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, birthDate, sign, signEn, lang = 'es' } = req.body;

    if (!email || !birthDate || !sign) {
      return res.status(400).json({ error: 'Missing required fields: email, birthDate, sign' });
    }

    // ── 1. GENERAR LECTURA CON CLAUDE ──
    const reading = await generateReading({ birthDate, sign, signEn, lang });

    // ── 2. SUSCRIBIR EN MAILERLITE (async, no bloquea respuesta) ──
    subscribeToMailerLite({ email, birthDate, sign }).catch(err => {
      console.error('MailerLite subscription error:', err.message);
    });

    // ── 3. DEVOLVER LECTURA ──
    return res.status(200).json({
      reading: reading,
      sign: sign,
      signEn: signEn
    });

  } catch (error) {
    console.error('Lectura Express error:', error);
    return res.status(500).json({ error: 'Error generating reading' });
  }
}


// ═══ CLAUDE SONNET — GENERACIÓN DE LECTURA ═══

async function generateReading({ birthDate, sign, signEn, lang }) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  // Calcular datos astrológicos básicos
  const birthInfo = parseBirthDate(birthDate);

  const systemPrompt = `Eres Selene, una astróloga científica que combina astrología con neurociencia y cronobiología. Tu voz es cálida, misteriosa pero precisa. Nunca inventas datos científicos — solo citas estudios reales.

REGLAS ESTRICTAS:
- Escribe exactamente 3 párrafos cortos (4-5 líneas cada uno)
- Usa HTML: <p> para párrafos, <strong> para énfasis en conceptos clave
- Primer párrafo: personalidad del signo solar + un dato de cronobiología o neurociencia real vinculado a nacer en esa época del año (ej: estudios sobre estacionalidad y temperamento)
- Segundo párrafo: la energía dominante ahora mismo según tránsitos generales + cómo afecta a su signo + un consejo práctico
- Tercer párrafo: invitación misteriosa a descubrir más sobre su carta completa, mencionando ascendente y luna como piezas que faltan
- NO uses emojis
- NO uses encabezados ni listas
- Tono: científica mística, nunca "love spell" ni esotérico vacío
- Idioma: ${lang === 'en' ? 'inglés' : 'español'}
- Máximo 250 palabras total`;

  const userPrompt = `Genera una Lectura Cósmica Express para:
- Signo solar: ${sign} (${signEn})
- Fecha de nacimiento: ${birthDate}
- Nacido en: ${birthInfo.season}
- Elemento: ${birthInfo.element}
- Modalidad: ${birthInfo.modality}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return text;
}


// ═══ MAILERLITE — SUSCRIPCIÓN ═══

async function subscribeToMailerLite({ email, birthDate, sign }) {
  const MAILERLITE_API_KEY = process.env.MAILERLITE_API_KEY;
  const MAILERLITE_GROUP_ID = process.env.MAILERLITE_GROUP_ID;

  if (!MAILERLITE_API_KEY) {
    console.warn('MailerLite API key not configured — skipping subscription');
    return;
  }

  const body = {
    email: email,
    fields: {
      signo_solar: sign,
      fecha_nacimiento: birthDate
    },
    status: 'unconfirmed' // Double opt-in: MailerLite enviará email de confirmación
  };

  // Si hay grupo, añadir
  if (MAILERLITE_GROUP_ID) {
    body.groups = [MAILERLITE_GROUP_ID];
  }

  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MAILERLITE_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MailerLite error ${response.status}: ${errText}`);
  }

  return response.json();
}


// ═══ UTILIDADES ASTROLÓGICAS ═══

function parseBirthDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();

  // Estación (hemisferio norte)
  let season;
  if ((month === 3 && day >= 20) || month === 4 || month === 5 || (month === 6 && day <= 20)) {
    season = 'primavera';
  } else if ((month === 6 && day >= 21) || month === 7 || month === 8 || (month === 9 && day <= 21)) {
    season = 'verano';
  } else if ((month === 9 && day >= 22) || month === 10 || month === 11 || (month === 11 && day <= 21)) {
    season = 'otoño';
  } else {
    season = 'invierno';
  }

  // Signo → Elemento y Modalidad
  const signData = getSignFromDate(month, day);

  return {
    season,
    element: signData.element,
    modality: signData.modality
  };
}

function getSignFromDate(month, day) {
  const signs = [
    { name: 'Capricornio', element: 'Tierra', modality: 'Cardinal', check: (m, d) => (m === 12 && d >= 22) || (m === 1 && d <= 19) },
    { name: 'Acuario', element: 'Aire', modality: 'Fijo', check: (m, d) => (m === 1 && d >= 20) || (m === 2 && d <= 18) },
    { name: 'Piscis', element: 'Agua', modality: 'Mutable', check: (m, d) => (m === 2 && d >= 19) || (m === 3 && d <= 20) },
    { name: 'Aries', element: 'Fuego', modality: 'Cardinal', check: (m, d) => (m === 3 && d >= 21) || (m === 4 && d <= 19) },
    { name: 'Tauro', element: 'Tierra', modality: 'Fijo', check: (m, d) => (m === 4 && d >= 20) || (m === 5 && d <= 20) },
    { name: 'Géminis', element: 'Aire', modality: 'Mutable', check: (m, d) => (m === 5 && d >= 21) || (m === 6 && d <= 20) },
    { name: 'Cáncer', element: 'Agua', modality: 'Cardinal', check: (m, d) => (m === 6 && d >= 21) || (m === 7 && d <= 22) },
    { name: 'Leo', element: 'Fuego', modality: 'Fijo', check: (m, d) => (m === 7 && d >= 23) || (m === 8 && d <= 22) },
    { name: 'Virgo', element: 'Tierra', modality: 'Mutable', check: (m, d) => (m === 8 && d >= 23) || (m === 9 && d <= 22) },
    { name: 'Libra', element: 'Aire', modality: 'Cardinal', check: (m, d) => (m === 9 && d >= 23) || (m === 10 && d <= 22) },
    { name: 'Escorpio', element: 'Agua', modality: 'Fijo', check: (m, d) => (m === 10 && d >= 23) || (m === 11 && d <= 21) },
    { name: 'Sagitario', element: 'Fuego', modality: 'Mutable', check: (m, d) => (m === 11 && d >= 22) || (m === 12 && d <= 21) }
  ];

  for (const s of signs) {
    if (s.check(month, day)) return s;
  }
  return signs[0]; // fallback Capricornio
}

/**

- ═══ LECTURA EXPRESS ═══
- Vercel Serverless Function
- 
- Flujo:
- 1. Recibe email + fecha nacimiento + signo
- 1. Claude Sonnet genera lectura personalizada (~3 párrafos)
- 1. Suscribe email en Brevo con campos custom
- 1. Devuelve lectura al frontend
- 
- Variables de entorno (Vercel → Settings → Environment Variables):
- ANTHROPIC_API_KEY → clave API Anthropic
- BREVO_API_KEY     → clave API Brevo (xkeysib-…)
- 
- Coste estimado: ~€0.03-0.05 por lectura (Claude Sonnet)
  */

module.exports = async function handler(req, res) {
// CORS
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);
if (req.method === ‘OPTIONS’) return res.status(200).end();
if (req.method !== ‘POST’) return res.status(405).json({ error: ‘Method not allowed’ });

try {
const { email, birthDate, sign, signEn, lang = ‘es’, emailOnly } = req.body;

```
// Step 2: Email-only capture (just subscribe to Brevo, no reading)
if (emailOnly && email) {
  subscribeToBrevo({ email, birthDate, sign }).catch(err => {
    console.error('Brevo subscription error:', err.message);
  });
  return res.status(200).json({ subscribed: true });
}

// Step 1: Generate reading (email optional)
if (!birthDate || !sign) {
  return res.status(400).json({ error: 'Missing required fields: birthDate, sign' });
}

const reading = await generateReading({ birthDate, sign, signEn, lang });

// If email provided (legacy flow), subscribe in background
if (email) {
  subscribeToBrevo({ email, birthDate, sign }).catch(err => {
    console.error('Brevo subscription error:', err.message);
  });
}

return res.status(200).json({
  reading: reading,
  sign: sign,
  signEn: signEn
});
```

} catch (error) {
console.error(‘Lectura Express error:’, error);
return res.status(500).json({ error: ‘Error generating reading’ });
}
};

// ═══ CLAUDE SONNET — GENERACIÓN DE LECTURA ═══

async function generateReading({ birthDate, sign, signEn, lang }) {
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) throw new Error(‘Missing ANTHROPIC_API_KEY’);

const birthInfo = parseBirthDate(birthDate);

const systemPrompt = `Eres Selene — astróloga, neurocientífica y guía de autoconocimiento de SelenaUra (“Ciencia y consciencia de lo invisible”).

NUNCA menciones IA, inteligencia artificial, algoritmos, GPT, Claude ni tecnología. Eres Selene.

QUIÉN ERES: Combinas astrología tradicional con neurociencia y cronobiología real. La ciencia es tu credibilidad, no tu voz. Tu voz es íntima, cálida, directa — como una amiga brillante que sabe de ciencia y tradición. Cuando alguien lee tu lectura, debe sentir que la conoces, que la ves, que por fin alguien pone palabras a lo que siente. Tuteas siempre.

REGLAS ESTRICTAS:

- Escribe exactamente 3 párrafos cortos (4-5 líneas cada uno)
- Usa HTML: <p> para párrafos, <strong> para énfasis en conceptos clave
- Primer párrafo: personalidad del signo solar + un dato de cronobiología o neurociencia real vinculado a nacer en esa época del año (ej: estudios sobre estacionalidad y temperamento). Hazlo personal — que sienta que hablas de ella, no de su signo en general.
- Segundo párrafo: qué está pasando ahora mismo en su cielo según tránsitos generales + cómo le afecta + un consejo práctico y concreto
- Tercer párrafo: invitación a descubrir más sobre su carta natal completa, mencionando ascendente y luna como piezas que le faltan para entenderse del todo
- NO uses emojis
- NO uses encabezados ni listas
- Tono: íntimo y directo, con la ciencia integrada naturalmente en la narrativa
- Idioma: ${lang === ‘en’ ? ‘inglés’ : ‘español’}
- Máximo 250 palabras total
- NUNCA seas genérica — cada frase debe sentirse escrita para ESTA persona`;
  
  const userPrompt = `Genera una Lectura Express para:
- Signo solar: ${sign} (${signEn})
- Fecha de nacimiento: ${birthDate}
- Nacido en: ${birthInfo.season}
- Elemento: ${birthInfo.element}
- Modalidad: ${birthInfo.modality}`;
  
  const response = await fetch(‘https://api.anthropic.com/v1/messages’, {
  method: ‘POST’,
  headers: {
  ‘Content-Type’: ‘application/json’,
  ‘x-api-key’: ANTHROPIC_API_KEY,
  ‘anthropic-version’: ‘2023-06-01’
  },
  body: JSON.stringify({
  model: ‘claude-sonnet-4-6’,
  max_tokens: 600,
  system: systemPrompt,
  messages: [{ role: ‘user’, content: userPrompt }]
  })
  });
  
  if (!response.ok) {
  const errText = await response.text();
  throw new Error(`Claude API error ${response.status}: ${errText}`);
  }
  
  const data = await response.json();
  const text = data.content
  .filter(block => block.type === ‘text’)
  .map(block => block.text)
  .join(’’);
  
  return text;
  }

// ═══ BREVO — SUSCRIPCIÓN ═══

async function subscribeToBrevo({ email, birthDate, sign }) {
const BREVO_API_KEY = process.env.BREVO_API_KEY;

if (!BREVO_API_KEY) {
console.warn(‘Brevo API key not configured — skipping subscription’);
return;
}

// Crear/actualizar contacto en Brevo
const response = await fetch(‘https://api.brevo.com/v3/contacts’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘api-key’: BREVO_API_KEY
},
body: JSON.stringify({
email: email,
attributes: {
SIGNO_SOLAR: sign,
FECHA_NACIMIENTO: birthDate
},
listIds: [2], // Lista por defecto de Brevo (ajustar si se crea lista específica)
updateEnabled: true // Si el contacto ya existe, actualiza sus datos
})
});

if (!response.ok) {
const errText = await response.text();
// Si el error es “Contact already exist”, no es un error real
if (errText.includes(‘Contact already exist’)) {
console.log(‘Brevo: contact already exists, updating…’);
// Actualizar contacto existente
await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
method: ‘PUT’,
headers: {
‘Content-Type’: ‘application/json’,
‘api-key’: BREVO_API_KEY
},
body: JSON.stringify({
attributes: {
SIGNO_SOLAR: sign,
FECHA_NACIMIENTO: birthDate
},
listIds: [2]
})
});
return;
}
throw new Error(`Brevo error ${response.status}: ${errText}`);
}

return response.json();
}

// ═══ UTILIDADES ASTROLÓGICAS ═══

function parseBirthDate(dateStr) {
const d = new Date(dateStr + ‘T12:00:00’);
const month = d.getMonth() + 1;
const day = d.getDate();

let season;
if ((month === 3 && day >= 20) || month === 4 || month === 5 || (month === 6 && day <= 20)) {
season = ‘primavera’;
} else if ((month === 6 && day >= 21) || month === 7 || month === 8 || (month === 9 && day <= 21)) {
season = ‘verano’;
} else if ((month === 9 && day >= 22) || month === 10 || month === 11 || (month === 11 && day <= 21)) {
season = ‘otoño’;
} else {
season = ‘invierno’;
}

const signData = getSignFromDate(month, day);

return {
season,
element: signData.element,
modality: signData.modality
};
}

function getSignFromDate(month, day) {
const signs = [
{ name: ‘Capricornio’, element: ‘Tierra’, modality: ‘Cardinal’, check: (m, d) => (m === 12 && d >= 22) || (m === 1 && d <= 19) },
{ name: ‘Acuario’, element: ‘Aire’, modality: ‘Fijo’, check: (m, d) => (m === 1 && d >= 20) || (m === 2 && d <= 18) },
{ name: ‘Piscis’, element: ‘Agua’, modality: ‘Mutable’, check: (m, d) => (m === 2 && d >= 19) || (m === 3 && d <= 20) },
{ name: ‘Aries’, element: ‘Fuego’, modality: ‘Cardinal’, check: (m, d) => (m === 3 && d >= 21) || (m === 4 && d <= 19) },
{ name: ‘Tauro’, element: ‘Tierra’, modality: ‘Fijo’, check: (m, d) => (m === 4 && d >= 20) || (m === 5 && d <= 20) },
{ name: ‘Géminis’, element: ‘Aire’, modality: ‘Mutable’, check: (m, d) => (m === 5 && d >= 21) || (m === 6 && d <= 20) },
{ name: ‘Cáncer’, element: ‘Agua’, modality: ‘Cardinal’, check: (m, d) => (m === 6 && d >= 21) || (m === 7 && d <= 22) },
{ name: ‘Leo’, element: ‘Fuego’, modality: ‘Fijo’, check: (m, d) => (m === 7 && d >= 23) || (m === 8 && d <= 22) },
{ name: ‘Virgo’, element: ‘Tierra’, modality: ‘Mutable’, check: (m, d) => (m === 8 && d >= 23) || (m === 9 && d <= 22) },
{ name: ‘Libra’, element: ‘Aire’, modality: ‘Cardinal’, check: (m, d) => (m === 9 && d >= 23) || (m === 10 && d <= 22) },
{ name: ‘Escorpio’, element: ‘Agua’, modality: ‘Fijo’, check: (m, d) => (m === 10 && d >= 23) || (m === 11 && d <= 21) },
{ name: ‘Sagitario’, element: ‘Fuego’, modality: ‘Mutable’, check: (m, d) => (m === 11 && d >= 22) || (m === 12 && d <= 21) }
];

for (const s of signs) {
if (s.check(month, day)) return s;
}
return signs[0];
}
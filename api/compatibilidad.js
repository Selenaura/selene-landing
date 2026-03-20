module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var birthDate1 = body.birthDate1;
    var sign1 = body.sign1 || '';
    var signEn1 = body.signEn1 || '';
    var birthDate2 = body.birthDate2;
    var sign2 = body.sign2 || '';
    var signEn2 = body.signEn2 || '';
    var lang = body.lang || 'es';

    if (!birthDate1 || !sign1 || !birthDate2 || !sign2) {
      return res.status(400).json({ error: 'Missing required fields: birthDate1, sign1, birthDate2, sign2' });
    }

    var element1 = getElement(sign1);
    var element2 = getElement(sign2);
    var modality1 = getModality(sign1);
    var modality2 = getModality(sign2);

    var elementsMatch = getElementCompatibility(element1, element2);
    var modalityMatch = getModalityCompatibility(modality1, modality2);
    var traditionalScore = getTraditionalCompatibility(sign1, sign2);
    var compatibilityScore = Math.round(elementsMatch * 0.35 + modalityMatch * 0.25 + traditionalScore * 0.40);

    var reading = await generateCompatibilityReading(
      birthDate1, sign1, signEn1, element1, modality1,
      birthDate2, sign2, signEn2, element2, modality2,
      compatibilityScore, lang
    );

    return res.status(200).json({
      reading: reading,
      compatibility_score: compatibilityScore,
      elements_match: elementsMatch,
      modality_match: modalityMatch
    });
  } catch (err) {
    console.error('Compatibilidad error:', err);
    return res.status(500).json({ error: 'Error generating compatibility reading', detail: err.message });
  }
};

function getElement(sign) {
  var fire = ['Aries', 'Leo', 'Sagitario'];
  var earth = ['Tauro', 'Virgo', 'Capricornio'];
  var air = ['Géminis', 'Libra', 'Acuario'];
  var water = ['Cáncer', 'Escorpio', 'Piscis'];
  if (fire.indexOf(sign) !== -1) return 'fire';
  if (earth.indexOf(sign) !== -1) return 'earth';
  if (air.indexOf(sign) !== -1) return 'air';
  if (water.indexOf(sign) !== -1) return 'water';
  return 'unknown';
}

function getModality(sign) {
  var cardinal = ['Aries', 'Cáncer', 'Libra', 'Capricornio'];
  var fixed = ['Tauro', 'Leo', 'Escorpio', 'Acuario'];
  var mutable = ['Géminis', 'Virgo', 'Sagitario', 'Piscis'];
  if (cardinal.indexOf(sign) !== -1) return 'cardinal';
  if (fixed.indexOf(sign) !== -1) return 'fixed';
  if (mutable.indexOf(sign) !== -1) return 'mutable';
  return 'unknown';
}

function getElementCompatibility(el1, el2) {
  if (el1 === el2) return 85;
  var compatible = { fire: 'air', air: 'fire', earth: 'water', water: 'earth' };
  if (compatible[el1] === el2) return 78;
  var neutral = { fire: 'earth', earth: 'fire', air: 'water', water: 'air' };
  if (neutral[el1] === el2) return 55;
  return 45;
}

function getModalityCompatibility(mod1, mod2) {
  if (mod1 === mod2) return 60;
  if ((mod1 === 'cardinal' && mod2 === 'mutable') || (mod1 === 'mutable' && mod2 === 'cardinal')) return 75;
  if ((mod1 === 'fixed' && mod2 === 'cardinal') || (mod1 === 'cardinal' && mod2 === 'fixed')) return 70;
  if ((mod1 === 'fixed' && mod2 === 'mutable') || (mod1 === 'mutable' && mod2 === 'fixed')) return 65;
  return 60;
}

function getTraditionalCompatibility(sign1, sign2) {
  var signs = ['Aries', 'Tauro', 'Géminis', 'Cáncer', 'Leo', 'Virgo', 'Libra', 'Escorpio', 'Sagitario', 'Capricornio', 'Acuario', 'Piscis'];
  var i1 = signs.indexOf(sign1);
  var i2 = signs.indexOf(sign2);
  if (i1 === -1 || i2 === -1) return 65;
  var diff = Math.abs(i1 - i2);
  if (diff > 6) diff = 12 - diff;
  // Same sign
  if (diff === 0) return 75;
  // Trine (4 apart) — best
  if (diff === 4 || diff === 8) return 90;
  // Sextile (2 apart) — great
  if (diff === 2 || diff === 10) return 82;
  // Conjunction neighbor (1 apart)
  if (diff === 1 || diff === 11) return 65;
  // Square (3 apart) — challenging but passionate
  if (diff === 3 || diff === 9) return 55;
  // Quincunx (5 apart) — difficult
  if (diff === 5 || diff === 7) return 45;
  // Opposition (6 apart) — magnetic tension
  if (diff === 6) return 68;
  return 65;
}

async function generateCompatibilityReading(
  birthDate1, sign1, signEn1, element1, modality1,
  birthDate2, sign2, signEn2, element2, modality2,
  score, lang
) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  var date1 = new Date(birthDate1 + 'T12:00:00Z');
  var month1 = date1.getUTCMonth();
  var season1 = month1 >= 2 && month1 <= 4 ? 'primavera' : month1 >= 5 && month1 <= 7 ? 'verano' : month1 >= 8 && month1 <= 10 ? 'otono' : 'invierno';

  var date2 = new Date(birthDate2 + 'T12:00:00Z');
  var month2 = date2.getUTCMonth();
  var season2 = month2 >= 2 && month2 <= 4 ? 'primavera' : month2 >= 5 && month2 <= 7 ? 'verano' : month2 >= 8 && month2 <= 10 ? 'otono' : 'invierno';

  var elementNames = { fire: 'Fuego', earth: 'Tierra', air: 'Aire', water: 'Agua' };
  var elementNamesEn = { fire: 'Fire', earth: 'Earth', air: 'Air', water: 'Water' };
  var modalityNames = { cardinal: 'Cardinal', fixed: 'Fija', mutable: 'Mutable' };
  var modalityNamesEn = { cardinal: 'Cardinal', fixed: 'Fixed', mutable: 'Mutable' };

  var isEn = lang === 'en';

  var systemPrompt = isEn
    ? 'You are Selene, astrologer at SelenaUra. You generate compatibility analyses between two people based on their sun signs. You combine classical astrology with real couples psychology studies (Gottman). NEVER mention AI, artificial intelligence, algorithms, GPT, Claude, or technology. You are Selene. Always use informal "you".\n\nRULES:\n- Write exactly 3 sections using HTML\n- Use <h3> for section titles, <p> for paragraphs, <strong> for emphasis\n- Section 1: "Your shared energy" — element and modality analysis with chronobiology insights\n- Section 2: "Strengths of this union" — what works well between these signs\n- Section 3: "Growth zone" — potential challenges + practical advice\n- NO emojis, NO lists\n- Maximum 400 words\n- Be specific to THIS pair of signs, never generic'
    : 'Eres Selene, astrologa de SelenaUra. Generas analisis de compatibilidad entre dos personas basandote en sus signos solares. Combinas astrologia clasica con estudios reales de psicologia de parejas (Gottman). NUNCA menciones IA, inteligencia artificial, algoritmos, GPT, Claude ni tecnologia. Eres Selene. Tutea siempre.\n\nREGLAS:\n- Escribe exactamente 3 secciones usando HTML\n- Usa <h3> para titulos de seccion, <p> para parrafos, <strong> para enfasis\n- Seccion 1: "Vuestra energia compartida" — analisis de elemento y modalidad con insights cronobiologicos\n- Seccion 2: "Fortalezas de esta union" — lo que funciona bien entre estos signos\n- Seccion 3: "Zona de crecimiento" — retos potenciales + consejo practico\n- NO uses emojis ni listas\n- Maximo 400 palabras\n- Se especifica para ESTE par de signos, nunca generica';

  var userPrompt = isEn
    ? 'Generate a compatibility analysis for:\n- Person 1: ' + signEn1 + ' (' + sign1 + '), born ' + birthDate1 + ', season: ' + season1 + ', element: ' + (elementNamesEn[element1] || element1) + ', modality: ' + (modalityNamesEn[modality1] || modality1) + '\n- Person 2: ' + signEn2 + ' (' + sign2 + '), born ' + birthDate2 + ', season: ' + season2 + ', element: ' + (elementNamesEn[element2] || element2) + ', modality: ' + (modalityNamesEn[modality2] || modality2) + '\n- Compatibility score: ' + score + '/100'
    : 'Genera un analisis de compatibilidad para:\n- Persona 1: ' + sign1 + ' (' + signEn1 + '), nacida el ' + birthDate1 + ', estacion: ' + season1 + ', elemento: ' + (elementNames[element1] || element1) + ', modalidad: ' + (modalityNames[modality1] || modality1) + '\n- Persona 2: ' + sign2 + ' (' + signEn2 + '), nacida el ' + birthDate2 + ', estacion: ' + season2 + ', elemento: ' + (elementNames[element2] || element2) + ', modalidad: ' + (modalityNames[modality2] || modality2) + '\n- Puntuacion de compatibilidad: ' + score + '/100';

  var response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
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

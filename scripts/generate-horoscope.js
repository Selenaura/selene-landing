// scripts/generate-horoscope.js
// Genera 12 horoscopitos diarios + dato cósmico con Claude Haiku
// Coste estimado: ~€0.01/día

const fs = require('fs');
const path = require('path');

const SIGNS = [
  "Aries","Tauro","Géminis","Cáncer","Leo","Virgo",
  "Libra","Escorpio","Sagitario","Capricornio","Acuario","Piscis"
];

const today = new Date().toISOString().split('T')[0];

async function generate() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY no configurada");
    process.exit(1);
  }

  const prompt = `Eres SELENE, una entidad que fusiona neurociencia y astrología. Hoy es ${today}.

Genera un JSON con esta estructura EXACTA (sin markdown, sin backticks, solo JSON puro):

{
  "date": "${today}",
  "horoscopes": {
    "aries": "texto",
    "tauro": "texto",
    "geminis": "texto",
    "cancer": "texto",
    "leo": "texto",
    "virgo": "texto",
    "libra": "texto",
    "escorpio": "texto",
    "sagitario": "texto",
    "capricornio": "texto",
    "acuario": "texto",
    "piscis": "texto"
  },
  "cosmicFact": {
    "text": "dato científico fascinante",
    "source": "autor et al. (año), revista"
  }
}

REGLAS para cada horóscopo (40-60 palabras cada uno):
- Tono: científico-místico, en español, segunda persona (tú)
- Conecta un proceso neurológico o psicológico REAL con la energía del día
- Menciona algo concreto: una hormona, un circuito cerebral, un estudio, un ritmo biológico
- NO uses frases vagas tipo "el universo te sonríe" o "las estrellas indican"
- SÍ usa frases tipo "tu corteza prefrontal está optimizada hoy para..." o "los niveles de serotonina favorecen..."
- Cada signo debe tener un enfoque DIFERENTE (creatividad, relaciones, decisiones, introspección, etc.)
- Incluye una acción concreta o consejo práctico

El dato cósmico debe ser un hecho científico REAL y verificable de neurociencia, cronobiología, astronomía o psicología. Cita el estudio real con autores y revista.

Responde SOLO con el JSON. Sin explicaciones ni texto adicional.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("❌ API error:", response.status, err);
      process.exit(1);
    }

    const data = await response.json();
    const text = data.content[0].text.trim();
    
    // Limpiar posibles backticks
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Validar JSON
    const parsed = JSON.parse(clean);
    
    // Verificar estructura
    if (!parsed.horoscopes || !parsed.cosmicFact) {
      throw new Error("Estructura JSON inválida");
    }

    const signKeys = ["aries","tauro","geminis","cancer","leo","virgo",
                      "libra","escorpio","sagitario","capricornio","acuario","piscis"];
    for (const key of signKeys) {
      if (!parsed.horoscopes[key]) {
        throw new Error(`Falta horóscopo para: ${key}`);
      }
    }

    // Añadir metadata
    parsed.generatedAt = new Date().toISOString();

    // Guardar
    const outDir = path.join(__dirname, '..', 'public', 'data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const outPath = path.join(outDir, 'horoscope.json');
    fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');

    console.log(`✦ Horóscopo generado para ${today}`);
    console.log(`  12 signos + dato cósmico`);
    console.log(`  Guardado en: public/data/horoscope.json`);
    
    // Tokens usados
    const usage = data.usage;
    if (usage) {
      console.log(`  Tokens: ${usage.input_tokens} in + ${usage.output_tokens} out`);
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

generate();

/**
 * ═══ SELENE BLOG GENERATOR ═══
 * 
 * Generates SEO-optimized blog articles using Claude API.
 * Runs via GitHub Actions 2x/week (Monday & Thursday 7AM Spain).
 * 
 * Flow:
 *   1. Read topics.json → find next "pending" topic
 *   2. Generate full HTML article with Claude Sonnet
 *   3. Save to public/blog/[slug].html
 *   4. Regenerate public/blog/index.html
 *   5. Update topics.json status → "published"
 * 
 * Env: ANTHROPIC_API_KEY
 * Cost: ~€0.08-0.15 per article (Sonnet, ~3000 tokens output)
 */

const fs = require('fs');
const path = require('path');

const TOPICS_PATH = path.join(__dirname, 'topics.json');
const BLOG_DIR = path.join(__dirname, '..', 'public', 'blog');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  // 1. Read topics
  const data = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf-8'));
  const pending = data.topics.find(t => t.status === 'pending');

  if (!pending) {
    console.log('No pending topics. Add more to topics.json.');
    process.exit(0);
  }

  console.log(`Generating article: ${pending.title}`);

  // 2. Generate article with Claude
  const articleHtml = await generateArticle(pending, data.config);

  // 3. Save article
  if (!fs.existsSync(BLOG_DIR)) fs.mkdirSync(BLOG_DIR, { recursive: true });
  const articlePath = path.join(BLOG_DIR, `${pending.slug}.html`);
  fs.writeFileSync(articlePath, articleHtml, 'utf-8');
  console.log(`Saved: ${articlePath}`);

  // 4. Update topic status
  pending.status = 'published';
  pending.publishedAt = new Date().toISOString().split('T')[0];
  fs.writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2), 'utf-8');

  // 5. Regenerate blog index
  generateBlogIndex(data.topics);
  console.log('Blog index regenerated.');

  // 6. Regenerate sitemap with new article
  regenerateSitemap(data.topics);

  console.log('Done!');
}

// ═══ GENERATE ARTICLE WITH CLAUDE ═══

async function generateArticle(topic, config) {
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `Eres la redactora principal de Selene (selenaura.com), una plataforma de astrología y desarrollo intuitivo con base científica. Tu voz es "científica mística": combinas profundidad espiritual con rigor científico.

REGLAS DE ESCRITURA:
- Escribe en español de España (no latinoamericano)
- Tono cálido, misterioso pero preciso. Nunca condescendiente
- SIEMPRE incluye 2-4 referencias a estudios científicos REALES (peer-reviewed o de instituciones reconocidas). NUNCA inventes estudios
- Estudios válidos: HeartMath, cronobiología (Rosenthal, Wehr, Cajochen), neuroplasticidad (Davidson, Draganski), psicología (Kahneman, Goleman, Seligman, Gottman, Jung, Erikson), dermatoglifia, marcadores somáticos (Damasio)
- Estructura HTML semántica: usa <h2> para secciones principales y <h3> para subsecciones
- Incluye 3-5 párrafos de introducción enganchante antes del primer H2
- Cada sección debe tener 2-4 párrafos sustanciales
- Longitud total: 1.800-2.500 palabras
- NO uses listas con viñetas (bullets). Todo en prosa fluida con párrafos
- Incluye cajas científicas con este formato exacto:
  <div class="science-box"><div class="label">Dato neurocientífico</div><p>texto</p><div class="source">Autor (año). Título. Revista.</div></div>
- Incluye al menos 2 science-box en el artículo
- NUNCA hagas afirmaciones pseudocientíficas sin fundamento. Si algo es tradición astrológica, di "la tradición astrológica interpreta..." Si algo es ciencia, cita la fuente
- NUNCA menciones "inteligencia artificial", "IA", "AI" ni "generado por IA" en el contenido visible. Las herramientas se presentan como "Selene", no como tecnología
- Al final, incluye un CTA natural hacia el producto relevante
- NO incluyas el DOCTYPE, head, nav ni footer — solo el contenido del <article>. Empieza directamente con el primer párrafo

ESTRUCTURA OBLIGATORIA PARA VISIBILIDAD EN BUSCADORES (AEO/GEO):

1. RESPUESTA DIRECTA AL INICIO (primeros 2 párrafos):
   - El primer párrafo responde directamente a la pregunta principal del artículo
   - Formato: "[Término o pregunta principal]. [Definición directa en 1-2 frases]."

2. BLOQUE DE DEFINICIÓN (antes del primer H2):
   Si el artículo define un concepto, incluir un párrafo con formato:
   "[Término] es [definición concisa]. [Expansión con contexto científico o histórico]."

3. ESTADÍSTICAS CON FUENTE (mínimo 2 por artículo):
   Formato: "[Dato específico] (Fuente: [Autor/Institución, año])."
   NUNCA inventar estadísticas. Solo usar datos verificables.

4. SECCIÓN FAQ OBLIGATORIA (al final del artículo, ANTES del CTA):
   Incluir entre 3 y 5 preguntas frecuentes con respuesta directa.
   Formato HTML:
   <h2>Preguntas frecuentes sobre [tema]</h2>
   <h3>¿[Pregunta concreta]?</h3>
   <p>[Respuesta directa en 2-4 frases. Sin relleno.]</p>

5. DATOS DE FAQ para schema (OBLIGATORIO al final, después de todo el contenido visible):
   Incluir un bloque JSON comentado:
   <!-- FAQS_JSON
   [
     {"question": "¿Pregunta 1?", "answer": "Respuesta 1 completa."},
     {"question": "¿Pregunta 2?", "answer": "Respuesta 2 completa."}
   ]
   -->

6. PÁRRAFOS CORTOS: Máximo 3-4 líneas por párrafo. Los sistemas de búsqueda extraen bloques cortos mejor.

7. HEADINGS DESCRIPTIVOS: Cada H2 y H3 debe ser una respuesta parcial, no solo un título temático.
   Mal: "Tipos de líneas"
   Bien: "Las 6 líneas principales y qué revela cada una"`;

  const userPrompt = `Escribe un artículo de blog SEO para Selene sobre:

TÍTULO: ${topic.title}
KEYWORDS TARGET: ${topic.keywords}
ENFOQUE: ${topic.focus}
CATEGORÍA: ${topic.category}
CTA PRINCIPAL: ${topic.cta}

Escribe SOLO el contenido del artículo (párrafos, h2, h3, science-box, cta-card). No incluyas HTML boilerplate, head, nav ni footer.

Para el CTA final usa este formato:
<div class="cta-card"><h3>[título CTA]</h3><p>[descripción]</p><a href="${getCTAUrl(topic.cta)}" class="btn-gold">[texto botón] ✦</a></div>`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const content = result.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Extract FAQs from content if present
  const faqs = extractFaqs(content);

  // Wrap in full HTML page
  return wrapInTemplate(topic, content, today, faqs);
}

// ═══ HTML TEMPLATE ═══

function wrapInTemplate(topic, articleContent, date, faqs) {
  const readingTime = Math.ceil(articleContent.split(/\s+/).length / 200);

  // Build FAQPage schema if FAQs exist
  const faqSchema = faqs && faqs.length > 0 ? `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": ${JSON.stringify(faqs.map(f => ({
    "@type": "Question",
    "name": f.question,
    "acceptedAnswer": { "@type": "Answer", "text": f.answer }
  })))}
}
</script>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${topic.title} | Selene</title>
<meta name="description" content="${topic.focus.substring(0, 155)}">
<meta property="og:title" content="${topic.title}">
<meta property="og:description" content="${topic.focus.substring(0, 155)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://selenaura.com/blog/${topic.slug}.html">
<meta property="og:locale" content="es_ES">
<meta property="article:published_time" content="${date}">
<meta property="article:author" content="SelenaUra">
<link rel="canonical" href="https://selenaura.com/blog/${topic.slug}.html">
<meta name="p:domain_verify" content="597160e7a6e46fe761d945c8de0f9b87"/>
<!-- Pinterest Tag -->
<script>
!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
pintrk('load','2613574143672');
pintrk('page');
</script>
<noscript><img height="1" width="1" style="display:none;" alt="" src="https://ct.pinterest.com/v3/?event=init&tid=2613574143672&noscript=1" /></noscript>
<!-- end Pinterest Tag -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${topic.title.replace(/"/g, '\\"')}",
  "author": {"@type": "Organization", "name": "SelenaUra", "url": "https://selenaura.com"},
  "publisher": {"@type": "Organization", "name": "SelenaUra", "logo": {"@type": "ImageObject", "url": "https://selenaura.com/favicon.svg"}},
  "datePublished": "${date}",
  "dateModified": "${date}",
  "description": "${topic.focus.substring(0, 155).replace(/"/g, '\\"')}",
  "inLanguage": "es",
  "url": "https://selenaura.com/blog/${topic.slug}.html",
  "about": {"@type": "Thing", "name": "${topic.category}"}
}
</script>
${faqSchema}
<style>
:root{
  --bg:#0A0A0F;--card:rgba(255,255,255,.03);--border:rgba(255,255,255,.06);
  --gold:#C9A84C;--gold-light:#E8D5A3;--gold-dim:rgba(201,168,76,.08);
  --white:#F0EDE4;--white-dim:rgba(240,237,228,.85);--text-mid:rgba(240,237,228,.65);--text-dim:rgba(240,237,228,.4);
  --teal:#4A6FA5;--serif:'Cormorant Garamond',Georgia,serif;--sans:'Outfit',system-ui,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--white);font-family:var(--sans);font-weight:300;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:var(--gold);text-decoration:none;transition:color .3s}
a:hover{color:var(--gold-light)}
.nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;background:rgba(10,10,15,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.nav-brand{font-family:var(--serif);font-size:20px;letter-spacing:5px;color:var(--gold)}
.nav-links{display:flex;gap:24px;font-size:13px;color:var(--text-mid)}
.nav-links a{color:var(--text-mid)}.nav-links a:hover{color:var(--gold)}
@media(max-width:600px){.nav-links{display:none}}
.article-header{padding:140px 24px 50px;text-align:center;max-width:760px;margin:0 auto;position:relative}
.article-header::before{content:'';position:absolute;top:60px;left:50%;transform:translateX(-50%);width:500px;height:350px;background:radial-gradient(ellipse,rgba(201,168,76,.05),transparent 70%);pointer-events:none}
.article-tag{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--teal);margin-bottom:14px;font-weight:500}
.article-header h1{font-family:var(--serif);font-size:clamp(28px,4.5vw,44px);font-weight:300;line-height:1.25;margin-bottom:18px;position:relative}
.article-meta{font-size:12px;color:var(--text-dim);letter-spacing:1px}
.article-meta span{margin:0 8px}
.article-body{max-width:680px;margin:0 auto;padding:40px 24px 60px}
.article-body p{font-size:15.5px;color:var(--white-dim);line-height:1.9;margin-bottom:24px}
.article-body h2{font-family:var(--serif);font-size:26px;font-weight:400;color:var(--white);margin:48px 0 18px;padding-top:16px;position:relative}
.article-body h2::before{content:'✦';position:absolute;left:-28px;color:var(--gold);font-size:14px;top:22px;opacity:.5}
@media(max-width:700px){.article-body h2::before{display:none}}
.article-body h3{font-family:var(--serif);font-size:20px;font-weight:400;color:var(--gold-light);margin:32px 0 14px}
.article-body strong{color:var(--white);font-weight:500}
.article-body em{color:var(--gold-light);font-style:italic}
.science-box{margin:28px 0;padding:24px 28px;border-left:3px solid var(--teal);background:rgba(74,111,165,.04);border-radius:0 14px 14px 0}
.science-box .label{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--teal);font-weight:600;margin-bottom:8px}
.science-box p{font-size:14px;color:var(--text-mid);margin-bottom:0;line-height:1.8}
.science-box .source{font-size:11px;color:var(--text-dim);font-style:italic;margin-top:8px}
.cta-card{margin:40px 0;padding:32px;text-align:center;border:1px solid rgba(201,168,76,.12);border-radius:20px;background:rgba(201,168,76,.02)}
.cta-card h3{font-family:var(--serif);font-size:22px;font-weight:300;margin-bottom:10px}
.cta-card p{font-size:13px;color:var(--text-mid);margin-bottom:20px}
.btn-gold{display:inline-block;padding:14px 32px;background:var(--gold-dim);color:var(--gold);border-radius:28px;font-size:13px;font-weight:500;transition:all .3s;border:1px solid rgba(201,168,76,.15)}
.btn-gold:hover{background:var(--gold);color:var(--bg)}
footer{padding:40px 24px 28px;text-align:center;border-top:1px solid var(--border)}
.footer-brand{font-family:var(--serif);font-size:20px;color:var(--gold);letter-spacing:4px;margin-bottom:6px}
.footer-tagline{font-family:var(--serif);font-size:11px;font-style:italic;color:var(--text-dim);margin-bottom:20px}
.footer-links{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin-bottom:16px}
.footer-links a{font-size:11px;color:var(--text-dim)}.footer-links a:hover{color:var(--gold)}
.footer-legal{font-size:10px;color:var(--text-dim)}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.article-header,.article-body{animation:fadeUp .6s ease}
</style>
</head>
<body>
<nav class="nav">
  <a href="/" class="nav-brand">SELENE</a>
  <div class="nav-links">
    <a href="/">Inicio</a>
    <a href="/blog/">Blog</a>
    <a href="https://carta.selenaura.com">Carta Astral</a>
    <a href="https://tarot.selenaura.com">Tarot</a>
  </div>
</nav>
<header class="article-header">
  <div class="article-tag">${topic.category}</div>
  <h1>${topic.title}</h1>
  <div class="article-meta">Selene <span>·</span> ${formatDate(date)} <span>·</span> ${readingTime} min lectura</div>
</header>
<article class="article-body">
${articleContent}
</article>
<footer>
  <div class="footer-brand">SELENE</div>
  <div class="footer-tagline">Ciencia y consciencia de lo invisible</div>
  <div class="footer-links">
    <a href="/">Inicio</a><a href="/blog/">Blog</a><a href="/aviso-legal.html">Aviso Legal</a><a href="/privacidad.html">Privacidad</a><a href="/cookies.html">Cookies</a>
  </div>
  <div class="footer-legal">© 2026 Selene. Todos los derechos reservados.</div>
</footer>
</body>
</html>`;
}

// ═══ BLOG INDEX GENERATOR ═══

function generateBlogIndex(topics) {
  const published = topics
    .filter(t => t.status === 'published')
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  const cards = published.map((t, i) => {
    const isFeatured = i === 0;
    return `
    <a href="/blog/${t.slug}.html" class="article-card${isFeatured ? ' featured' : ''} reveal stagger-${(i % 3) + 1}">
      <div class="card-tag">${isFeatured ? '✦ Destacado · ' : ''}${t.category}</div>
      <div class="card-date">${formatDate(t.publishedAt)}</div>
      <h2 class="card-title">${t.title}</h2>
      <p class="card-excerpt">${t.focus.substring(0, 200)}${t.focus.length > 200 ? '...' : ''}</p>
      <span class="card-cta">Leer artículo</span>
    </a>`;
  }).join('\n');

  const indexHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>Blog Selene · Astrología con base científica</title>
<meta name="description" content="Artículos de astrología, tarot y desarrollo intuitivo respaldados por neurociencia, cronobiología y estudios peer-reviewed. El blog de Selene.">
<meta property="og:title" content="Blog Selene · Astrología con base científica">
<meta property="og:description" content="Artículos de astrología, tarot y desarrollo intuitivo respaldados por neurociencia y cronobiología.">
<meta name="p:domain_verify" content="597160e7a6e46fe761d945c8de0f9b87"/>
<script>
!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
pintrk('load','2613574143672');
pintrk('page');
</script>
<noscript><img height="1" width="1" style="display:none;" alt="" src="https://ct.pinterest.com/v3/?event=init&tid=2613574143672&noscript=1" /></noscript>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0A0A0F;--card:rgba(255,255,255,.03);--border:rgba(255,255,255,.06);
  --gold:#C9A84C;--gold-light:#E8D5A3;--gold-dim:rgba(201,168,76,.08);
  --white:#F0EDE4;--white-dim:rgba(240,237,228,.85);--text-mid:rgba(240,237,228,.65);--text-dim:rgba(240,237,228,.4);
  --teal:#4A6FA5;--serif:'Cormorant Garamond',Georgia,serif;--sans:'Outfit',system-ui,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--white);font-family:var(--sans);font-weight:300;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;background:rgba(10,10,15,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.nav-brand{font-family:var(--serif);font-size:20px;letter-spacing:5px;color:var(--gold)}
.nav-links{display:flex;gap:24px;font-size:13px;color:var(--text-mid)}
.nav-links a:hover{color:var(--gold)}
@media(max-width:600px){.nav-links{display:none}}
.blog-hero{padding:140px 24px 60px;text-align:center;position:relative;overflow:hidden}
.blog-hero::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:600px;height:400px;background:radial-gradient(ellipse,rgba(201,168,76,.06),transparent 70%);pointer-events:none}
.blog-tag{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:16px;font-weight:500}
.blog-hero h1{font-family:var(--serif);font-size:clamp(32px,5vw,52px);font-weight:300;line-height:1.2;margin-bottom:16px}
.blog-hero h1 em{font-style:italic;color:var(--gold-light)}
.blog-hero p{font-size:15px;color:var(--text-mid);max-width:540px;margin:0 auto}
.container{max-width:900px;margin:0 auto;padding:0 24px}
.articles-grid{display:grid;gap:28px;padding-bottom:80px}
.article-card{display:block;border:1px solid var(--border);border-radius:20px;padding:36px 32px;background:var(--card);transition:all .4s;position:relative;overflow:hidden}
.article-card::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 200px 150px at 20% 30%,rgba(201,168,76,.04),transparent);opacity:0;transition:opacity .4s}
.article-card:hover{border-color:rgba(201,168,76,.15);transform:translateY(-3px)}
.article-card:hover::before{opacity:1}
.article-card.featured{border-color:rgba(201,168,76,.12);background:rgba(201,168,76,.02)}
.article-card.featured .card-tag{color:var(--gold)}
.card-tag{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--teal);margin-bottom:12px;font-weight:500}
.card-date{font-size:11px;color:var(--text-dim);margin-bottom:14px}
.card-title{font-family:var(--serif);font-size:24px;font-weight:400;line-height:1.3;margin-bottom:12px;position:relative}
.card-excerpt{font-size:14px;color:var(--text-mid);line-height:1.8;margin-bottom:20px}
.card-cta{font-size:12px;color:var(--gold);font-weight:500;letter-spacing:1px;display:inline-flex;align-items:center;gap:6px}
.card-cta::after{content:'→';transition:transform .3s}
.article-card:hover .card-cta::after{transform:translateX(4px)}
.blog-cta{text-align:center;padding:60px 24px 80px;border-top:1px solid var(--border)}
.blog-cta h3{font-family:var(--serif);font-size:24px;font-weight:300;margin-bottom:12px}
.blog-cta p{font-size:13px;color:var(--text-mid);margin-bottom:24px}
.btn-gold{display:inline-block;padding:14px 32px;background:var(--gold-dim);color:var(--gold);border-radius:28px;font-size:13px;font-weight:500;transition:all .3s;border:1px solid rgba(201,168,76,.15)}
.btn-gold:hover{background:var(--gold);color:var(--bg)}
footer{padding:40px 24px 28px;text-align:center;border-top:1px solid var(--border)}
.footer-brand{font-family:var(--serif);font-size:20px;color:var(--gold);letter-spacing:4px;margin-bottom:6px}
.footer-tagline{font-family:var(--serif);font-size:11px;font-style:italic;color:var(--text-dim);margin-bottom:20px}
.footer-links{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin-bottom:16px}
.footer-links a{font-size:11px;color:var(--text-dim)}.footer-links a:hover{color:var(--gold)}
.footer-legal{font-size:10px;color:var(--text-dim)}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.reveal{opacity:0;animation:fadeUp .6s ease forwards}
.stagger-1{animation-delay:.1s}.stagger-2{animation-delay:.2s}.stagger-3{animation-delay:.3s}
</style>
</head>
<body>
<nav class="nav">
  <a href="/" class="nav-brand">SELENE</a>
  <div class="nav-links">
    <a href="/">Inicio</a>
    <a href="/blog/" style="color:var(--gold)">Blog</a>
    <a href="https://carta.selenaura.com">Carta Astral</a>
    <a href="https://tarot.selenaura.com">Tarot</a>
    <a href="https://quiro.selenaura.com">Quirología</a>
  </div>
</nav>
<header class="blog-hero">
  <div class="blog-tag">El observatorio de Selene</div>
  <h1>Ciencia y consciencia<br>de lo <em>invisible</em></h1>
  <p>Astrología, tarot y desarrollo intuitivo respaldados por neurociencia, cronobiología y estudios peer-reviewed.</p>
</header>
<main class="container">
  <div class="articles-grid">
${cards}
  </div>
</main>
<section class="blog-cta">
  <h3>¿Quieres tu lectura personalizada?</h3>
  <p>Recibe una lectura cósmica express gratuita generada por Selene, basada en tu fecha de nacimiento.</p>
  <a href="/#lectura-express" class="btn-gold">Descubrir mi lectura ✦</a>
</section>
<footer>
  <div class="footer-brand">SELENE</div>
  <div class="footer-tagline">Ciencia y consciencia de lo invisible</div>
  <div class="footer-links">
    <a href="/">Inicio</a><a href="/blog/">Blog</a><a href="/aviso-legal.html">Aviso Legal</a><a href="/privacidad.html">Privacidad</a><a href="/cookies.html">Cookies</a>
  </div>
  <div class="footer-legal">© 2026 Selene. Todos los derechos reservados.</div>
</footer>
</body>
</html>`;

  fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), indexHtml, 'utf-8');
}

// ═══ FAQ EXTRACTION ═══

function extractFaqs(content) {
  const match = content.match(/<!--\s*FAQS_JSON\s*([\s\S]*?)-->/);
  if (!match) return [];
  try {
    return JSON.parse(match[1].trim());
  } catch (e) {
    console.warn('Could not parse FAQS_JSON:', e.message);
    return [];
  }
}

// ═══ SITEMAP GENERATOR ═══

function regenerateSitemap(topics) {
  const published = topics
    .filter(t => t.status === 'published')
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  const today = new Date().toISOString().split('T')[0];

  const blogUrls = published.map(t => `  <url>
    <loc>https://selenaura.com/blog/${t.slug}.html</loc>
    <lastmod>${t.publishedAt || today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Main pages -->
  <url>
    <loc>https://selenaura.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://selenaura.com/blog/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>

  <!-- Published blog articles -->
${blogUrls}

  <!-- Product pages -->
  <url>
    <loc>https://selenaura.com/carta-gratis.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- Subdomains -->
  <url>
    <loc>https://carta.selenaura.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://tarot.selenaura.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://quiro.selenaura.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://academy.selenaura.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>

  <!-- Legal pages -->
  <url>
    <loc>https://selenaura.com/aviso-legal.html</loc>
    <lastmod>2026-03-20</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://selenaura.com/privacidad.html</loc>
    <lastmod>2026-03-20</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://selenaura.com/cookies.html</loc>
    <lastmod>2026-03-20</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
`;

  const sitemapPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
  fs.writeFileSync(sitemapPath, sitemap, 'utf-8');
  console.log('Sitemap regenerated.');
}

// ═══ UTILITIES ═══

function getCTAUrl(cta) {
  const urls = {
    'carta-astral': 'https://carta.selenaura.com',
    'tarot': 'https://tarot.selenaura.com',
    'quirologia': 'https://quiro.selenaura.com',
    'lectura-express': 'https://selenaura.com/#lectura-express',
    'compatibilidad': 'https://carta.selenaura.com',
    'horoscopo': 'https://selenaura.com/#horoscopo-section'
  };
  return urls[cta] || 'https://selenaura.com';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

main().catch(err => {
  console.error('Blog generator failed:', err);
  process.exit(1);
});

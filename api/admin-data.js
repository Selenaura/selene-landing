module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = authHeader.replace('Bearer ', '');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'SUPABASE vars no configuradas' });
  }

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    if (!userRes.ok) {
      return res.status(401).json({ error: 'Token invalido' });
    }

    const user = await userRes.json();

    if (ADMIN_EMAIL && user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'No tienes acceso al panel de administracion' });
    }

    const [stripeData, brevoContacts, brevoListInfo, funnelData, academiaData] = await Promise.allSettled([
      fetchStripe(),
      fetchBrevoContacts(),
      fetchBrevoListInfo(),
      fetchFunnel(),
      fetchAcademia()
    ]);

    return res.status(200).json({
      user: { email: user.email, name: user.user_metadata?.full_name || user.email },
      stripe: stripeData.status === 'fulfilled' ? stripeData.value : { error: stripeData.reason?.message },
      brevo_contacts: brevoContacts.status === 'fulfilled' ? brevoContacts.value : { error: brevoContacts.reason?.message },
      brevo_list: brevoListInfo.status === 'fulfilled' ? brevoListInfo.value : { error: brevoListInfo.reason?.message },
      funnel: funnelData.status === 'fulfilled' ? funnelData.value : { error: funnelData.reason?.message },
      academia: academiaData.status === 'fulfilled' ? academiaData.value : { error: academiaData.reason?.message },
      generated_at: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { error: 'STRIPE_SECRET_KEY no configurada' };

  const headers = { 'Authorization': `Bearer ${key}` };

  // CRITICAL: Use payment_intents instead of charges
  // The charges API returns inflated numbers (329.92 when real revenue is 7.96)
  const [piRes, balanceRes, productsRes, sessionsRes] = await Promise.all([
    fetch('https://api.stripe.com/v1/payment_intents?limit=100', { headers }),
    fetch('https://api.stripe.com/v1/balance', { headers }),
    fetch('https://api.stripe.com/v1/products?limit=20&active=true', { headers }),
    fetch('https://api.stripe.com/v1/checkout/sessions?limit=20', { headers })
  ]);

  const piData = await piRes.json();
  const balance = await balanceRes.json();
  const productsData = await productsRes.json();
  const sessionsData = await sessionsRes.json();

  const succeeded = (piData.data || []).filter(p => p.status === 'succeeded');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const thisMonth = succeeded.filter(p => p.created >= startOfMonth);

  const revenueMonth = thisMonth.reduce((sum, p) => sum + p.amount, 0);
  const revenueTotal = succeeded.reduce((sum, p) => sum + p.amount, 0);

  // Build product-level revenue from checkout sessions
  const byProduct = {};
  succeeded.forEach(p => {
    const desc = p.description || p.metadata?.product || 'Desconocido';
    if (!byProduct[desc]) byProduct[desc] = { count: 0, revenue: 0 };
    byProduct[desc].count++;
    byProduct[desc].revenue += p.amount;
  });

  // Map products with their prices
  const products = (productsData.data || []).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description || null,
    default_price: p.default_price || null,
    images: p.images || [],
    active: p.active
  }));

  // Fetch prices for products that have default_price
  const priceIds = products.map(p => p.default_price).filter(Boolean);
  let pricesMap = {};
  if (priceIds.length > 0) {
    try {
      const pricesRes = await fetch('https://api.stripe.com/v1/prices?limit=50&active=true', { headers });
      const pricesData = await pricesRes.json();
      (pricesData.data || []).forEach(pr => {
        pricesMap[pr.id] = {
          amount: pr.unit_amount,
          currency: pr.currency,
          type: pr.type
        };
      });
    } catch (e) {
      // Ignore price fetch errors
    }
  }

  // Enrich products with price info
  const productsWithPrices = products.map(p => ({
    ...p,
    price: p.default_price && pricesMap[p.default_price]
      ? pricesMap[p.default_price]
      : null
  }));

  // Recent checkout sessions for product-level detail
  const recentSessions = (sessionsData.data || [])
    .filter(s => s.payment_status === 'paid')
    .slice(0, 10)
    .map(s => ({
      amount: s.amount_total,
      currency: s.currency,
      email: s.customer_details?.email || null,
      date: new Date(s.created * 1000).toISOString()
    }));

  return {
    revenue_month_cents: revenueMonth,
    revenue_total_cents: revenueTotal,
    sales_month: thisMonth.length,
    sales_total: succeeded.length,
    by_product: byProduct,
    products: productsWithPrices,
    products_count: products.length,
    recent: succeeded.slice(0, 10).map(p => ({
      amount: p.amount,
      currency: p.currency,
      email: p.receipt_email || p.metadata?.email || null,
      description: p.description || p.metadata?.product || null,
      date: new Date(p.created * 1000).toISOString()
    })),
    recent_sessions: recentSessions,
    balance_available: balance.available?.[0]?.amount || 0,
    balance_pending: balance.pending?.[0]?.amount || 0
  };
}

async function fetchBrevoContacts() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { error: 'BREVO_API_KEY no configurada' };

  const res = await fetch('https://api.brevo.com/v3/contacts?limit=50&offset=0&sort=desc', {
    headers: { 'api-key': key, 'Accept': 'application/json' }
  });
  const data = await res.json();

  const contacts = (data.contacts || []).map(c => ({
    email: c.email,
    signo: c.attributes?.SIGNO_SOLAR || null,
    fecha_nacimiento: c.attributes?.FECHA_NACIMIENTO || null,
    ha_comprado: c.attributes?.HA_COMPRADO || false,
    created: c.createdAt
  }));

  const signos = {};
  (data.contacts || []).forEach(c => {
    const s = c.attributes?.SIGNO_SOLAR;
    if (s) signos[s] = (signos[s] || 0) + 1;
  });

  return { contacts, signos, total: data.count || 0 };
}

async function fetchBrevoListInfo() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { error: 'BREVO_API_KEY no configurada' };

  const res = await fetch('https://api.brevo.com/v3/contacts/lists/2', {
    headers: { 'api-key': key, 'Accept': 'application/json' }
  });
  return await res.json();
}

async function fetchFunnel() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { error: 'SUPABASE_SERVICE_KEY no configurada' };

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [todayRes, monthRes] = await Promise.all([
    fetch(`${url}/rest/v1/funnel_events?select=event_type&created_at=gte.${today}T00:00:00Z`, { headers }),
    fetch(`${url}/rest/v1/funnel_events?select=event_type,created_at&created_at=gte.${thirtyDaysAgo}T00:00:00Z&order=created_at.asc`, { headers })
  ]);

  const todayEvents = await todayRes.json();
  const monthEvents = await monthRes.json();

  const todayCounts = { lectura_generada: 0, email_capturado: 0, compra: 0 };
  (Array.isArray(todayEvents) ? todayEvents : []).forEach(e => {
    if (todayCounts[e.event_type] !== undefined) todayCounts[e.event_type]++;
  });

  const monthCounts = { lectura_generada: 0, email_capturado: 0, compra: 0 };
  const daily = {};
  (Array.isArray(monthEvents) ? monthEvents : []).forEach(e => {
    if (monthCounts[e.event_type] !== undefined) monthCounts[e.event_type]++;
    const day = e.created_at?.split('T')[0];
    if (day) {
      if (!daily[day]) daily[day] = { lectura_generada: 0, email_capturado: 0, compra: 0 };
      if (daily[day][e.event_type] !== undefined) daily[day][e.event_type]++;
    }
  });

  return { today: todayCounts, month: monthCounts, daily };
}

async function fetchAcademia() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { error: 'SUPABASE_SERVICE_KEY no configurada' };

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact'
  };

  const [profilesRes, enrollmentsRes, lessonsRes, quizRes, profilesDataRes] = await Promise.all([
    fetch(`${url}/rest/v1/profiles?select=id&limit=0`, {
      headers: { ...headers, 'Prefer': 'count=exact' }
    }),
    fetch(`${url}/rest/v1/enrollments?select=id&limit=0`, {
      headers: { ...headers, 'Prefer': 'count=exact' }
    }),
    fetch(`${url}/rest/v1/lesson_progress?select=id&limit=0`, {
      headers: { ...headers, 'Prefer': 'count=exact' }
    }),
    fetch(`${url}/rest/v1/quiz_attempts?select=score&limit=50`, { headers }),
    fetch(`${url}/rest/v1/profiles?select=id,name,sun_sign,xp,streak_days,last_active_at&order=last_active_at.desc.nullslast&limit=20`, { headers })
  ]);

  // Extract counts from Content-Range header
  const profilesCount = parseInt(profilesRes.headers.get('content-range')?.split('/')[1] || '0');
  const enrollmentsCount = parseInt(enrollmentsRes.headers.get('content-range')?.split('/')[1] || '0');
  const lessonsCount = parseInt(lessonsRes.headers.get('content-range')?.split('/')[1] || '0');

  const quizData = await quizRes.json();
  const profilesData = await profilesDataRes.json();

  const quizScores = Array.isArray(quizData) ? quizData : [];
  const avgScore = quizScores.length > 0
    ? Math.round(quizScores.reduce((sum, q) => sum + (q.score || 0), 0) / quizScores.length)
    : 0;

  const profiles = Array.isArray(profilesData) ? profilesData : [];
  const avgXp = profiles.length > 0
    ? Math.round(profiles.reduce((sum, p) => sum + (p.xp || 0), 0) / profiles.length)
    : 0;

  return {
    total_students: profilesCount,
    total_enrollments: enrollmentsCount,
    total_lessons_completed: lessonsCount,
    total_quiz_attempts: quizScores.length,
    avg_quiz_score: avgScore,
    avg_xp: avgXp,
    profiles: profiles
  };
}

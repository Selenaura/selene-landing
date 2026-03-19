export default async function handler(req, res) {
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

  const [chargesRes, balanceRes] = await Promise.all([
    fetch('https://api.stripe.com/v1/charges?limit=20', { headers }),
    fetch('https://api.stripe.com/v1/balance', { headers })
  ]);

  const charges = await chargesRes.json();
  const balance = await balanceRes.json();

  const succeeded = (charges.data || []).filter(c => c.status === 'succeeded');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const thisMonth = succeeded.filter(c => c.created >= startOfMonth);

  const revenueMonth = thisMonth.reduce((sum, c) => sum + c.amount, 0);
  const revenueTotal = succeeded.reduce((sum, c) => sum + c.amount, 0);

  const byProduct = {};
  succeeded.forEach(c => {
    const desc = c.description || c.metadata?.product || 'Desconocido';
    if (!byProduct[desc]) byProduct[desc] = { count: 0, revenue: 0 };
    byProduct[desc].count++;
    byProduct[desc].revenue += c.amount;
  });

  return {
    revenue_month_cents: revenueMonth,
    revenue_total_cents: revenueTotal,
    sales_month: thisMonth.length,
    sales_total: succeeded.length,
    by_product: byProduct,
    recent: succeeded.slice(0, 10).map(c => ({
      amount: c.amount,
      currency: c.currency,
      email: c.billing_details?.email || c.receipt_email || null,
      description: c.description || c.metadata?.product || null,
      date: new Date(c.created * 1000).toISOString()
    })),
    balance_available: balance.available?.[0]?.amount || 0,
    balance_pending: balance.pending?.[0]?.amount || 0
  };
}

async function fetchBrevoContacts() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { error: 'BREVO_API_KEY no configurada' };

  const res = await fetch('https://api.brevo.com/v3/contacts?limit=20&offset=0&sort=desc', {
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
    'Content-Type': 'application/json'
  };

  const [profilesRes, enrollmentsRes] = await Promise.all([
    fetch(`${url}/rest/v1/profiles?select=id,sun_sign,xp,streak_days,created_at&order=created_at.desc&limit=20`, { headers }),
    fetch(`${url}/rest/v1/enrollments?select=id,course_id,status,progress,enrolled_at&order=enrolled_at.desc&limit=20`, { headers })
  ]);

  const profiles = await profilesRes.json();
  const enrollments = await enrollmentsRes.json();

  return {
    total_students: Array.isArray(profiles) ? profiles.length : 0,
    total_enrollments: Array.isArray(enrollments) ? enrollments.length : 0,
    profiles: Array.isArray(profiles) ? profiles : [],
    enrollments: Array.isArray(enrollments) ? enrollments : []
  };
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var url = process.env.SUPABASE_URL || '';
  var key = process.env.SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).json({ url: url, key: key });
};

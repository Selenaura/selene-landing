// Re-engagement Cron — Finds inactive contacts and schedules RE1-RE3 emails
// Triggered by Vercel Cron monthly: GET /api/re-engage
// Targets contacts with no email_sequence activity in 60+ days

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  try {
    // Find contacts where ALL rows are sent=true and the latest next_send_at is older than 60 days
    var sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // Get all distinct emails that have sequence rows
    var allEmailsRes = await fetch(
      SUPABASE_URL + '/rest/v1/email_sequence?select=email&order=email.asc',
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    var allRows = await allEmailsRes.json();
    if (!Array.isArray(allRows) || allRows.length === 0) {
      return res.status(200).json({ scheduled: 0, message: 'No contacts found' });
    }

    // Get unique emails
    var emailSet = {};
    for (var i = 0; i < allRows.length; i++) {
      emailSet[allRows[i].email] = true;
    }
    var uniqueEmails = Object.keys(emailSet);

    var scheduled = 0;
    var skipped = 0;
    var errors = [];

    for (var j = 0; j < uniqueEmails.length; j++) {
      var email = uniqueEmails[j];
      try {
        // Get all sequence rows for this email
        var contactRes = await fetch(
          SUPABASE_URL + '/rest/v1/email_sequence?email=eq.' + encodeURIComponent(email) + '&order=next_send_at.desc',
          {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Content-Type': 'application/json'
            }
          }
        );

        var contactRows = await contactRes.json();
        if (!Array.isArray(contactRows) || contactRows.length === 0) continue;

        // Check if ALL rows are sent
        var allSent = true;
        for (var k = 0; k < contactRows.length; k++) {
          if (!contactRows[k].sent) {
            allSent = false;
            break;
          }
        }
        if (!allSent) {
          skipped++;
          continue;
        }

        // Check if the latest next_send_at is older than 60 days
        var latestDate = contactRows[0].next_send_at;
        if (!latestDate || latestDate > sixtyDaysAgo) {
          skipped++;
          continue;
        }

        // Check if re-engagement already scheduled (step 20, 21, or 22 exist)
        var hasReEngagement = false;
        for (var m = 0; m < contactRows.length; m++) {
          var s = contactRows[m].step;
          if (s === 20 || s === 21 || s === 22) {
            hasReEngagement = true;
            break;
          }
        }
        if (hasReEngagement) {
          skipped++;
          continue;
        }

        // Get sign info from existing rows
        var signoSolar = contactRows[0].signo_solar || null;
        var signoEn = contactRows[0].signo_en || null;
        var lang = contactRows[0].lang || 'es';

        // Insert 3 re-engagement rows: step 20 (now), step 21 (+7 days), step 22 (+14 days)
        var now = new Date();
        var step21Date = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        var step22Date = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        var insertRes = await fetch(
          SUPABASE_URL + '/rest/v1/email_sequence',
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify([
              {
                email: email,
                step: 20,
                next_send_at: now.toISOString(),
                sent: false,
                signo_solar: signoSolar,
                signo_en: signoEn,
                lang: lang
              },
              {
                email: email,
                step: 21,
                next_send_at: step21Date.toISOString(),
                sent: false,
                signo_solar: signoSolar,
                signo_en: signoEn,
                lang: lang
              },
              {
                email: email,
                step: 22,
                next_send_at: step22Date.toISOString(),
                sent: false,
                signo_solar: signoSolar,
                signo_en: signoEn,
                lang: lang
              }
            ])
          }
        );

        if (!insertRes.ok) {
          var errBody = await insertRes.text();
          console.error('Failed to insert re-engagement for ' + email + ':', errBody);
          errors.push({ email: email, error: errBody });
          continue;
        }

        scheduled++;
        console.log('Scheduled re-engagement RE1-RE3 for ' + email);
      } catch (err) {
        errors.push({ email: email, error: err.message });
        console.error('Re-engage error for ' + email + ':', err.message);
      }
    }

    return res.status(200).json({
      scheduled: scheduled,
      skipped: skipped,
      errors: errors.length,
      details: errors
    });
  } catch (err) {
    console.error('Re-engage cron error:', err);
    return res.status(500).json({ error: err.message });
  }
};

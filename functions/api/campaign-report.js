// functions/api/campaign-report.js
// POST /api/campaign-report?kind=daily|weekly[&date=YYYY-MM-DD][&dry=1]
//
// Builds the internal campaign report from Streak and emails it with Resend.
// Called on schedule by .github/workflows/campaign-reports.yml.
// Auth: header "Authorization: Bearer <REPORT_CRON_SECRET>".
// Env (Cloudflare Pages secrets): REPORT_CRON_SECRET, STREAK_API_KEY, RESEND_API_KEY.
// Optional: REPORT_TO (comma list, must be @gershonconsulting.com).
// dry=1 returns the HTML instead of sending.
import {
  DAILY_CODES, WEEKLY_CODES, DEFAULT_TO, SENDERS, computeDaily, computeWeekly, dailySubject, weeklySubject,
  renderDaily, renderDailyText, renderWeekly, renderWeeklyText, internalRecipients, lastWeek, nyDate,
} from '../_lib/campaigns.js';
import { streakClient, loadCampaignBoxes } from '../_lib/streak.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function buildReport(kind, date, get) {
  const today = date || nyDate(Date.now());
  if (kind === 'daily') {
    const load = await loadCampaignBoxes(get, DAILY_CODES, { start: today, end: today });
    const r = computeDaily(load.byCampaign, today);
    return { r, load, subject: dailySubject(r), html: renderDaily(r), text: renderDailyText(r), from: SENDERS.daily, idem: `campaign-daily-stats-${today}` };
  }
  const { start, end } = lastWeek(today);
  const load = await loadCampaignBoxes(get, WEEKLY_CODES, { start, end });
  const r = computeWeekly(load.byCampaign, start, end);
  return { r, load, subject: weeklySubject(r), html: renderWeekly(r), text: renderWeeklyText(r), from: SENDERS.weekly, idem: `campaign-weekly-${start}` };
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!env.REPORT_CRON_SECRET) return json({ ok: false, error: 'not configured: REPORT_CRON_SECRET missing' }, 503);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(token, env.REPORT_CRON_SECRET)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!env.STREAK_API_KEY) return json({ ok: false, error: 'not configured: STREAK_API_KEY missing' }, 503);

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  if (!['daily', 'weekly'].includes(kind)) return json({ ok: false, error: 'kind must be daily or weekly' }, 400);
  const date = url.searchParams.get('date');
  if (date && !/^\d{4}-\d\d-\d\d$/.test(date)) return json({ ok: false, error: 'date must be YYYY-MM-DD' }, 400);
  const dry = url.searchParams.get('dry') === '1';

  const rep = await buildReport(kind, date, streakClient(env.STREAK_API_KEY));
  const meta = { kind, subject: rep.subject, idempotencyKey: rep.idem, commentsChecked: rep.load.commentsChecked, commentsSkipped: rep.load.commentsSkipped };
  if (dry) return new Response(rep.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Report-Subject': encodeURIComponent(rep.subject) } });

  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'not configured: RESEND_API_KEY missing', ...meta }, 503);
  let to;
  try { to = internalRecipients(env.REPORT_TO ? env.REPORT_TO.split(',') : DEFAULT_TO); }
  catch (e) { return json({ ok: false, error: e.message }, 400); }

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': rep.idem },
    body: JSON.stringify({ from: rep.from, to, subject: rep.subject, html: rep.html, text: rep.text }),
  });
  const body = await send.json().catch(() => ({}));
  return json({ ok: send.ok, resendStatus: send.status, id: body.id || null, error: send.ok ? undefined : (body.message || body.name), ...meta }, send.ok ? 200 : 502);
}

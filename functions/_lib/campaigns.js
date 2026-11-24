// functions/_lib/campaigns.js
// Campaign reports (CC01 / CC02 / CC03 / CC09) — pure logic, no network.
//
// Replaces the reporting parts of scheduled tasks:
//   #36 weekly outreach report CC01/CC02/CC03  ┐ one WEEKLY email
//   #38 CC09 European trade agencies weekly    ┘
//   #41 CC02/CC03 daily stats                  ┐ one DAILY email
//   #08 step 10 (CC01 daily stats)             ┘
// Source of truth: Streak boxes (creation date, stage, last email sent /
// received timestamps, "Bounced ..." comments written by the campaign tasks).
// Everything here is pure so it can be unit-tested (tests/campaigns.test.mjs).

export const TZ = 'America/New_York';
export const DAILY_TARGET = 10;

export const PIPELINES = {
  gcPipeline: {
    name: 'GC Pipeline',
    key: 'agxzfm1haWxmb29nYWVyNwsSDE9yZ2FuaXphdGlvbiIQb2F0dGlhQGdtYWlsLmNvbQwLEghXb3JrZmxvdxiAgICAwLWbCgw',
  },
  gcCampaigns: {
    name: 'GC Campaigns',
    key: 'agxzfm1haWxmb29nYWVyPAsSDE9yZ2FuaXphdGlvbiIVZ2Vyc2hvbmNvbnN1bHRpbmcuY29tDAsSCFdvcmtmbG93GICAlZSi8K8JDA',
  },
  gcPartners: {
    name: 'GC Partners',
    key: 'agxzfm1haWxmb29nYWVyNwsSDE9yZ2FuaXphdGlvbiIQb2F0dGlhQGdtYWlsLmNvbQwLEghXb3JrZmxvdxiAgICA5L-ZCgw',
  },
};

// Where each campaign's boxes live (Origin field key + dropdown option key),
// copied from the scheduled-task prompts. CC01 moved from GC Pipeline to
// GC Campaigns on 2026-11-02; both are read so older CC01 boxes still count.
export const CAMPAIGNS = [
  { code: 'CC01', name: 'E2 New Companies', task: '08', target: DAILY_TARGET,
    sources: [{ pipeline: 'gcCampaigns', field: '1002', option: '9212' },
              { pipeline: 'gcPipeline', field: '1003', option: '9230' }] },
  { code: 'CC02', name: 'Europe to US Growth', task: '35', target: DAILY_TARGET,
    sources: [{ pipeline: 'gcPipeline', field: '1003', option: '9226' }] },
  { code: 'CC03', name: 'SelectUSA alumni', task: '34', target: DAILY_TARGET,
    sources: [{ pipeline: 'gcCampaigns', field: '1002', option: '9211' }] },
  { code: 'CC09', name: 'European trade agencies', task: '38', target: 0,
    sources: [{ pipeline: 'gcPartners', field: '1002', option: '9080' }] },
];

export const DAILY_CODES = ['CC01', 'CC02', 'CC03'];
export const WEEKLY_CODES = ['CC01', 'CC02', 'CC03', 'CC09'];

export const SENDERS = {
  daily: 'GC Campaign Daily Stats <reports@gershon.ai>',
  weekly: 'GC Outreach Report <reports@gershon.ai>',
};
export const DEFAULT_TO = ['report@gershonconsulting.com'];

// Internal-only guard: these reports must never reach a client or prospect.
export function internalRecipients(list) {
  const out = (list || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  if (!out.length) throw new Error('no recipients');
  for (const a of out) {
    if (!/^[^@\s]+@gershonconsulting\.com$/.test(a)) throw new Error(`recipient not internal: ${a}`);
  }
  return out;
}

// ---------- dates (America/New_York) ----------
const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function nyDate(ms) {
  if (ms === null || ms === undefined || ms === '' || Number.isNaN(Number(ms))) return null;
  return fmtDay.format(new Date(Number(ms)));
}
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(ymd) { return new Date(`${ymd}T12:00:00Z`).getUTCDay(); } // 0=Sun
// Last full Monday..Sunday week before the week containing `todayYmd`.
export function lastWeek(todayYmd) {
  const dow = weekday(todayYmd);
  const thisMonday = addDays(todayYmd, -((dow + 6) % 7));
  const start = addDays(thisMonday, -7);
  return { start, end: addDays(start, 6) };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(ymd) { const [, m, d] = ymd.split('-'); return `${MONTHS[+m - 1]} ${+d}`; }
export function between(ymd, start, end) { return !!ymd && ymd >= start && ymd <= end; }

// ---------- Streak box normalisation ----------
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// raw = Streak v1 box; stages = {stageKey: name}; bounceDates = ['YYYY-MM-DD', ...]
export function normalizeBox(raw, { campaign, pipeline, stages = {}, countries = {}, countryField, bounceDates = [] }) {
  // Streak exposes these "magic columns" at the top level of a v1 box; some
  // responses nest them under magicColumns, so read both.
  const m = (k) => num(raw[k] ?? (raw.magicColumns || {})[k]);
  const created = num(raw.creationTimestamp);
  const lastSent = m('lastEmailSentTimestamp');
  const lastRecv = m('lastEmailReceivedTimestamp');
  const lastStage = m('lastStageChangeTimestamp');
  const sentCount = m('totalNumberOfSentEmails');
  const commentCount = m('commentCount');
  const country = countryField ? (raw.fields || {})[countryField] : '';
  return {
    key: raw.boxKey || raw.key,
    name: raw.name || '?',
    campaign,
    pipeline,
    stageKey: raw.stageKey,
    stage: stages[raw.stageKey] || raw.stageKey || '?',
    country: countries[String(country)] || (country ? String(country) : ''),
    created, createdDay: nyDate(created),
    lastSent, lastSentDay: nyDate(lastSent),
    lastRecv, lastRecvDay: nyDate(lastRecv),
    lastStageDay: nyDate(lastStage),
    sentCount,
    commentCount,
    bounceDates,
  };
}

export function emailed(b) {
  if (b.sentCount !== null && b.sentCount !== undefined) return b.sentCount > 0;
  return !!(b.lastSent && b.created && b.lastSent >= b.created - 60000);
}
// A reply = an email received after the box was created, not on a day a bounce was logged.
export function repliedOn(b) {
  if (!b.lastRecv || !b.created || b.lastRecv <= b.created) return null;
  if (b.bounceDates.includes(b.lastRecvDay)) return null;
  return b.lastRecvDay;
}
export const isScheduledStage = (s) => /schedul/i.test(String(s || ''));

// Which boxes need a comments lookup (bounces) for a window — keeps the
// Streak subrequest count low.
export function needsComments(b, start, end) {
  if (b.commentCount === 0) return false;
  return between(b.createdDay, start, end) || between(b.lastSentDay, start, end) || between(b.lastRecvDay, start, end);
}

// ---------- aggregation ----------
export function statsForWindow(boxes, start, end) {
  const inNew = boxes.filter((b) => between(b.createdDay, start, end));
  const intros = inNew.filter(emailed);
  const followUps = boxes.filter((b) => b.createdDay && b.createdDay < start && between(b.lastSentDay, start, end));
  const replies = boxes.filter((b) => between(repliedOn(b), start, end));
  const bounces = boxes.filter((b) => b.bounceDates.some((d) => between(d, start, end)));
  const meetings = boxes.filter((b) => isScheduledStage(b.stage) && between(b.lastStageDay, start, end));
  return {
    newCompanies: inNew.length,
    intros: intros.length,
    linkedinOnly: inNew.length - intros.length,
    followUps: followUps.length,
    replies: replies.length,
    bounces: bounces.length,
    meetings: meetings.length,
    lists: { newBoxes: inNew, replies, bounces, meetings, followUps },
  };
}

export function computeDaily(boxesByCampaign, day, codes = DAILY_CODES) {
  const campaigns = codes.map((code) => {
    const c = CAMPAIGNS.find((x) => x.code === code);
    const src = boxesByCampaign[code] || { boxes: [], error: 'not loaded' };
    const s = statsForWindow(src.boxes, day, day);
    return { ...c, error: src.error || null, ...s, onTarget: s.newCompanies >= c.target };
  });
  const total = (k) => campaigns.reduce((a, c) => a + c[k], 0);
  return {
    kind: 'daily', day, campaigns,
    totals: { newCompanies: total('newCompanies'), intros: total('intros'), followUps: total('followUps'),
      replies: total('replies'), bounces: total('bounces'), linkedinOnly: total('linkedinOnly') },
    allOnTarget: campaigns.every((c) => !c.error && c.onTarget),
  };
}

export function computeWeekly(boxesByCampaign, start, end, codes = WEEKLY_CODES) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const campaigns = codes.map((code) => {
    const c = CAMPAIGNS.find((x) => x.code === code);
    const src = boxesByCampaign[code] || { boxes: [], error: 'not loaded' };
    const s = statsForWindow(src.boxes, start, end);
    const perDay = days.map((d) => ({ day: d, n: src.boxes.filter((b) => b.createdDay === d).length }));
    const byStage = {};
    for (const b of src.boxes) byStage[b.stage] = (byStage[b.stage] || 0) + 1;
    const toDate = {
      companies: src.boxes.length,
      emailed: src.boxes.filter(emailed).length,
      replied: src.boxes.filter((b) => repliedOn(b)).length,
    };
    const weekTarget = c.target * 7;
    return { ...c, error: src.error || null, ...s, perDay, byStage, toDate, weekTarget,
      daysOnTarget: c.target ? perDay.filter((p) => p.n >= c.target).length : null,
      allBoxes: src.boxes };
  });
  const outreach = campaigns.filter((c) => c.target);
  const sum = (arr, k) => arr.reduce((a, c) => a + c[k], 0);
  const target = sum(outreach, 'weekTarget');
  return {
    kind: 'weekly', start, end, days, campaigns,
    totals: { newCompanies: sum(outreach, 'newCompanies'), intros: sum(outreach, 'intros'),
      followUps: sum(campaigns, 'followUps'), replies: sum(campaigns, 'replies'),
      meetings: sum(campaigns, 'meetings'), bounces: sum(campaigns, 'bounces'), target },
    pctOfTarget: target ? Math.round((sum(outreach, 'newCompanies') / target) * 100) : 0,
  };
}

// ---------- rendering ----------
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const INK = '#12211d', LINK = '#1f6f5c', MUTED = '#4f5c60', RED = '#b42318', GREEN = '#0b6b3a';
const F = `font-family:Arial,Helvetica,sans-serif;color:${INK}`;
const OK = '&#9989;', KO = '&#10060;';
export const boxUrl = (k) => `https://www.streak.com/a/boxes/${encodeURIComponent(k)}`;
export const pipelineUrl = (p) => `https://www.streak.com/a/pipelines/${PIPELINES[p].key}`;
const a = (href, text) => `<a href="${esc(href)}" style="color:${LINK}">${esc(text)}</a>`;
const th = (t) => `<th align="left" style="${F};font-size:12px;padding:6px;border-bottom:2px solid #d8e2de">${t}</th>`;
const td = (t, extra = '') => `<td style="${F};font-size:13px;padding:6px;border-bottom:1px solid #e6ece9;${extra}">${t}</td>`;
const tile = (label, val, sub = '') => `<td align="center" bgcolor="#ffffff" style="${F};padding:10px;border:1px solid #d8e2de;background-color:#ffffff"><div style="font-size:22px;font-weight:bold">${val}</div><div style="font-size:12px;color:${MUTED}">${esc(label)}</div>${sub ? `<div style="font-size:11px;color:${MUTED}">${sub}</div>` : ''}</td>`;
const h2 = (t) => `<h2 style="${F};font-size:17px;margin:22px 0 8px">${t}</h2>`;
const wrap = (inner) => `<!DOCTYPE html><html><body bgcolor="#ffffff" style="margin:0;padding:0;background-color:#ffffff"><div style="${F};max-width:680px;margin:0 auto;padding:16px;background-color:#ffffff">${inner}</div></body></html>`;
const errLine = (c) => `<p style="${F};color:${RED};font-size:13px">${KO} ${esc(c.code)}: Streak not reachable (${esc(c.error)}). Numbers for this campaign are missing, not zero.</p>`;
const SOURCE_NOTE = 'Source: Streak boxes (created date, stage, last email sent/received, "Bounced" comments written by the campaign tasks). Follow-ups = older boxes with an email sent in the period (one per company). Replies include auto-replies Streak attached to the thread.';

export function dailySubject(r) {
  const mark = r.allOnTarget ? '✅' : '❌';
  const per = r.campaigns.map((c) => `${c.code} ${c.error ? '?' : c.newCompanies}/${c.target}`).join(' · ');
  return `${mark} [08+41] Campaign daily stats ${shortDate(r.day)}: ${per}, ${r.totals.intros} intros, ${r.totals.followUps} follow-ups, ${r.totals.replies} replies`;
}
export function weeklySubject(r) {
  return `[36+38] Outreach weekly — ${shortDate(r.start)}–${shortDate(r.end)}, ${r.end.slice(0, 4)}: ${r.totals.newCompanies} companies, ${r.totals.replies} replies, ${r.totals.meetings} meetings`;
}

function hotLeads(campaigns) {
  const rows = [];
  for (const c of campaigns) for (const b of c.lists.replies) rows.push({ c, b });
  if (!rows.length) return `<p style="${F};font-size:13px;color:${MUTED}">No replies in this period.</p>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('Campaign')}${th('Company')}${th('Stage')}${th('Reply')}</tr>${rows.map(({ c, b }) => `<tr>${td(esc(c.code))}${td(a(boxUrl(b.key), b.name))}${td(esc(b.stage))}${td(esc(b.lastRecvDay))}</tr>`).join('')}</table>`;
}

export function renderDaily(r) {
  const parts = [];
  parts.push(`<div style="${F};font-size:12px;color:${MUTED}">Task #08 + #41 · Campaigns CC01, CC02, CC03 · report.gershoncrm.com</div>`);
  parts.push(`<h1 style="${F};font-size:21px;margin:6px 0 2px">Campaign daily stats — ${esc(shortDate(r.day))}, ${r.day.slice(0, 4)}</h1>`);
  parts.push(`<div style="${F};font-size:13px;color:${MUTED}">Objective: 10 new companies a day per campaign.</div>`);
  parts.push(`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px"><tr>${th('')}${r.campaigns.map((c) => th(esc(c.code))).join('')}</tr>`);
  const row = (label, f) => `<tr>${td(`<b>${esc(label)}</b>`)}${r.campaigns.map((c) => td(c.error ? `<span style="color:${RED}">?</span>` : f(c))).join('')}</tr>`;
  parts.push(row('New companies', (c) => `${c.newCompanies} of ${c.target} ${c.onTarget ? OK : KO}`));
  parts.push(row('Intros sent', (c) => c.intros));
  parts.push(row('LinkedIn only / not emailed', (c) => c.linkedinOnly));
  parts.push(row('Follow-ups sent', (c) => c.followUps));
  parts.push(row('Replies', (c) => `${c.replies}${c.replies ? ` ${OK}` : ''}`));
  parts.push(row('Bounces', (c) => c.bounces));
  parts.push('</table>');
  for (const c of r.campaigns) if (c.error) parts.push(errLine(c));
  parts.push(h2('Replies (hot leads)'));
  parts.push(hotLeads(r.campaigns));
  parts.push(h2("Today's new companies"));
  const rows = [];
  for (const c of r.campaigns) for (const b of c.lists.newBoxes) rows.push(`<tr>${td(esc(c.code))}${td(a(boxUrl(b.key), b.name))}${td(esc(b.country))}${td(esc(b.stage))}${td(emailed(b) ? 'intro sent' : 'LinkedIn only')}</tr>`);
  parts.push(rows.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('Campaign')}${th('Company')}${th('Country')}${th('Stage')}${th('Email')}</tr>${rows.join('')}</table>` : `<p style="${F};font-size:13px;color:${RED}">${KO} No new company was added today. The campaign runs may not have happened.</p>`);
  parts.push(`<p style="${F};font-size:12px;color:${MUTED};margin-top:20px">Pipelines: ${a(pipelineUrl('gcCampaigns'), 'GC Campaigns')} · ${a(pipelineUrl('gcPipeline'), 'GC Pipeline')}<br>${esc(SOURCE_NOTE)}<br>Task #08 + #41 · sent by report.gershoncrm.com</p>`);
  return wrap(parts.join(''));
}

export function renderDailyText(r) {
  const L = [`Campaign daily stats — ${r.day} (Task #08 + #41)`, ''];
  for (const c of r.campaigns) {
    if (c.error) { L.push(`${c.code}: Streak not reachable (${c.error}) — numbers missing`); continue; }
    L.push(`${c.code} ${c.name}: ${c.newCompanies}/${c.target} new ${c.onTarget ? '✅' : '❌'}, ${c.intros} intros, ${c.linkedinOnly} LinkedIn only, ${c.followUps} follow-ups, ${c.replies} replies, ${c.bounces} bounces`);
  }
  L.push('', 'Replies:');
  let any = false;
  for (const c of r.campaigns) for (const b of c.lists.replies) { any = true; L.push(`- ${c.code} ${b.name} (${b.stage}) ${boxUrl(b.key)}`); }
  if (!any) L.push('- none');
  L.push('', 'New companies:');
  for (const c of r.campaigns) for (const b of c.lists.newBoxes) L.push(`- ${c.code} ${b.name} | ${b.country || '-'} | ${b.stage} | ${emailed(b) ? 'intro sent' : 'LinkedIn only'}`);
  L.push('', SOURCE_NOTE, 'Task #08 + #41');
  return L.join('\n');
}

export function renderWeekly(r) {
  const p = [];
  const T = r.totals;
  p.push(`<div style="${F};font-size:12px;color:${MUTED}">Task #36 + #38 · GC Outreach — Weekly report · report.gershoncrm.com</div>`);
  p.push(`<h1 style="${F};font-size:21px;margin:6px 0 2px">GC Outreach — week of ${esc(shortDate(r.start))}–${esc(shortDate(r.end))}, ${r.end.slice(0, 4)}</h1>`);
  p.push(`<div style="${F};font-size:13px;color:${MUTED}">Target: 10 new companies a day per campaign (CC01, CC02, CC03) = ${T.target} this week · ${r.pctOfTarget}% reached ${r.pctOfTarget >= 100 ? OK : KO}</div>`);
  p.push(`<table width="100%" cellpadding="0" cellspacing="6" style="margin-top:10px"><tr>${tile('New companies', T.newCompanies, `of ${T.target}`)}${tile('Intros', T.intros)}${tile('Follow-ups', T.followUps)}${tile('Replies', T.replies)}${tile('Meetings', T.meetings)}${tile('Bounces', T.bounces)}</tr></table>`);
  for (const c of r.campaigns) if (c.error) p.push(errLine(c));
  p.push(h2('1 · Hot leads (replies)'));
  p.push(hotLeads(r.campaigns));
  const meet = r.campaigns.flatMap((c) => c.lists.meetings.map((b) => `<li>${esc(c.code)} ${a(boxUrl(b.key), b.name)} — ${esc(b.stage)} (${esc(b.lastStageDay)})</li>`));
  if (meet.length) p.push(`<p style="${F};font-size:13px;margin:8px 0 2px"><b>Meetings scheduled this week</b></p><ul style="${F};font-size:13px">${meet.join('')}</ul>`);
  p.push(h2('2 · Campaigns'));
  for (const c of r.campaigns.filter((x) => x.target)) {
    p.push(`<h3 style="${F};font-size:15px;margin:16px 0 6px">${esc(c.code)} — ${esc(c.name)} <span style="font-size:12px;color:${MUTED}">(task #${esc(c.task)})</span></h3>`);
    p.push(`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('New')}${th('Intros')}${th('LinkedIn only')}${th('Follow-ups')}${th('Replies')}${th('Bounces')}${th('Days on target')}</tr><tr>${td(`${c.newCompanies} / ${c.weekTarget} ${c.newCompanies >= c.weekTarget ? OK : KO}`)}${td(c.intros)}${td(c.linkedinOnly)}${td(c.followUps)}${td(c.replies)}${td(c.bounces)}${td(`${c.daysOnTarget} / 7`)}</tr></table>`);
    p.push(`<table cellpadding="0" cellspacing="2" style="margin:6px 0"><tr>${c.perDay.map((d) => `<td align="center" bgcolor="${d.n >= c.target ? '#e3f5ea' : '#fde4e1'}" style="${F};font-size:11px;padding:4px 6px;background-color:${d.n >= c.target ? '#e3f5ea' : '#fde4e1'};color:${d.n >= c.target ? GREEN : RED}">${esc(shortDate(d.day))}<br><b>${d.n}</b></td>`).join('')}</tr></table>`);
    p.push(`<div style="${F};font-size:12px;color:${MUTED}">To date: ${c.toDate.companies} companies · ${c.toDate.emailed} emailed · ${c.toDate.replied} replied</div>`);
    if (c.lists.newBoxes.length) {
      p.push(`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px"><tr>${th('Company')}${th('Country')}${th('Added')}${th('Stage')}${th('Email')}</tr>${c.lists.newBoxes.map((b) => `<tr>${td(a(boxUrl(b.key), b.name))}${td(esc(b.country))}${td(esc(b.createdDay))}${td(esc(b.stage))}${td(b.bounceDates.length ? `${KO} bounced` : repliedOn(b) ? `${OK} replied` : emailed(b) ? 'sent' : 'LinkedIn only')}</tr>`).join('')}</table>`);
    }
  }
  const cc09 = r.campaigns.find((c) => c.code === 'CC09');
  if (cc09) {
    p.push(h2('3 · CC09 — European trade agencies'));
    if (!cc09.error) {
      p.push(`<div style="${F};font-size:13px">${cc09.toDate.companies} agencies contacted · ${cc09.toDate.replied} replied to date · ${cc09.replies} replies, ${cc09.followUps} follow-ups, ${cc09.bounces} bounces this week</div>`);
      const rows = [...cc09.allBoxes].sort((x, y) => (y.lastRecv || 0) - (x.lastRecv || 0)).map((b) => {
        const last = [b.lastSentDay, b.lastRecvDay].filter(Boolean).sort().pop() || '-';
        return `<tr>${td(a(boxUrl(b.key), b.name))}${td(esc(b.stage))}${td(esc(last))}${td(repliedOn(b) ? `${OK} replied ${esc(b.lastRecvDay)}` : `${KO} no reply`)}</tr>`;
      });
      p.push(`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px"><tr>${th('Agency')}${th('Stage')}${th('Last touch')}${th('Status')}</tr>${rows.join('')}</table>`);
      p.push(`<div style="${F};font-size:12px;margin-top:4px">${a(pipelineUrl('gcPartners'), 'GC Partners pipeline')} · ${a('https://claude.ai/artifact/B4SxjGf9h9sStyfXsjMqEN', 'CC09 plan')}</div>`);
    }
  }
  p.push(h2('4 · Pipeline by stage (to date)'));
  const stageRows = r.campaigns.filter((c) => !c.error).map((c) => `<tr>${td(esc(c.code))}${td(Object.entries(c.byStage).sort().map(([s, n]) => `${esc(s)}: <b>${n}</b>`).join(' · ') || '-')}</tr>`);
  p.push(`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${stageRows.join('')}</table>`);
  p.push(h2('5 · Problems'));
  const probs = [];
  for (const c of r.campaigns) {
    if (c.error) probs.push(`${KO} ${esc(c.code)}: Streak not reachable — numbers missing.`);
    else if (c.target && c.daysOnTarget < 7) probs.push(`${KO} ${esc(c.code)}: ${7 - c.daysOnTarget} of 7 days under ${c.target} new companies (${c.newCompanies}/${c.weekTarget}). Check task #${esc(c.task)} runs.`);
  }
  p.push(probs.length ? `<ul style="${F};font-size:13px">${probs.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p style="${F};font-size:13px;color:${GREEN}">${OK} No problem found.</p>`);
  p.push(`<p style="${F};font-size:12px;color:${MUTED};margin-top:20px">Pipelines: ${a(pipelineUrl('gcCampaigns'), 'GC Campaigns')} · ${a(pipelineUrl('gcPipeline'), 'GC Pipeline')} · ${a(pipelineUrl('gcPartners'), 'GC Partners')}<br>${esc(SOURCE_NOTE)}<br>Task #36 + #38 · sent by report.gershoncrm.com</p>`);
  return wrap(p.join(''));
}

export function renderWeeklyText(r) {
  const T = r.totals;
  const L = [`GC Outreach — weekly report ${r.start} to ${r.end} (Task #36 + #38)`,
    `New companies ${T.newCompanies}/${T.target} (${r.pctOfTarget}%) · intros ${T.intros} · follow-ups ${T.followUps} · replies ${T.replies} · meetings ${T.meetings} · bounces ${T.bounces}`, '', 'Hot leads:'];
  let any = false;
  for (const c of r.campaigns) for (const b of c.lists.replies) { any = true; L.push(`- ${c.code} ${b.name} (${b.stage}, ${b.lastRecvDay}) ${boxUrl(b.key)}`); }
  if (!any) L.push('- none');
  for (const c of r.campaigns) {
    L.push('');
    if (c.error) { L.push(`${c.code}: Streak not reachable (${c.error}) — numbers missing`); continue; }
    L.push(`${c.code} ${c.name}: new ${c.newCompanies}${c.target ? `/${c.weekTarget}` : ''}, intros ${c.intros}, follow-ups ${c.followUps}, replies ${c.replies}, bounces ${c.bounces}; to date ${c.toDate.companies} companies, ${c.toDate.replied} replied`);
    if (c.target) L.push(`  per day: ${c.perDay.map((d) => `${d.day.slice(5)} ${d.n}`).join(' | ')}`);
  }
  L.push('', SOURCE_NOTE, 'Task #36 + #38');
  return L.join('\n');
}

// Run: node --test tests/*.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../functions/_lib/campaigns.js';
import { bounceDaysFromComments, loadCampaignBoxes } from '../functions/_lib/streak.js';
import { buildReport } from '../functions/api/campaign-report.js';

const ny = (ymd, hh = 12) => Date.parse(`${ymd}T${String(hh).padStart(2, '0')}:00:00-05:00`);
const box = (o) => C.normalizeBox({ boxKey: o.key || o.name, name: o.name, stageKey: o.stage || '5001',
  creationTimestamp: o.created, lastEmailSentTimestamp: o.sent, lastEmailReceivedTimestamp: o.recv,
  lastStageChangeTimestamp: o.stageAt, totalNumberOfSentEmails: o.sentCount, fields: {} },
{ campaign: o.cc || 'CC01', pipeline: 'gcCampaigns', stages: { 5001: '1. Contacted', 5002: '2. Responded', 5003: '3. Call Scheduled' }, bounceDates: o.bounces || [] });

test('dates use America/New_York', () => {
  assert.equal(C.nyDate(Date.parse('2026-11-24T03:00:00Z')), '2026-11-23'); // 10pm ET
  assert.equal(C.nyDate(null), null);
  assert.deepEqual(C.lastWeek('2026-11-23'), { start: '2026-11-16', end: '2026-11-22' }); // Monday
  assert.deepEqual(C.lastWeek('2026-11-29'), { start: '2026-11-16', end: '2026-11-22' }); // Sunday
  assert.equal(C.shortDate('2026-11-05'), 'Nov 5');
});

test('daily stats: new, intros, linkedin only, follow-ups, replies, bounces', () => {
  const day = '2026-11-23';
  const boxes = [
    box({ name: 'A', created: ny(day, 9), sent: ny(day, 9), sentCount: 1 }),            // new + intro
    box({ name: 'B', created: ny(day, 9) }),                                              // new, LinkedIn only
    box({ name: 'C', created: ny('2026-11-10'), sent: ny(day, 10), sentCount: 2 }),       // follow-up
    box({ name: 'D', created: ny('2026-11-10'), sent: ny('2026-11-10'), recv: ny(day, 8), stage: '5002' }), // reply
    box({ name: 'E', created: ny('2026-11-10'), sent: ny('2026-11-10'), recv: ny(day, 8), bounces: [day] }), // bounce, not a reply
  ];
  const r = C.computeDaily({ CC01: { boxes }, CC02: { boxes: [] }, CC03: { boxes: [], error: 'Streak 500' } }, day);
  const cc01 = r.campaigns[0];
  assert.equal(cc01.newCompanies, 2);
  assert.equal(cc01.intros, 1);
  assert.equal(cc01.linkedinOnly, 1);
  assert.equal(cc01.followUps, 1);
  assert.equal(cc01.replies, 1);
  assert.equal(cc01.lists.replies[0].name, 'D');
  assert.equal(cc01.bounces, 1);
  assert.equal(cc01.onTarget, false);
  assert.equal(r.allOnTarget, false);
  assert.equal(r.campaigns[2].error, 'Streak 500');
});

test('emailed() falls back to timestamps when Streak gives no count', () => {
  assert.equal(C.emailed(box({ name: 'x', created: ny('2026-11-20'), sent: ny('2026-11-20', 13) })), true);
  assert.equal(C.emailed(box({ name: 'y', created: ny('2026-11-20') })), false);
  assert.equal(C.emailed(box({ name: 'z', created: ny('2026-11-20'), sent: ny('2026-11-20', 13), sentCount: 0 })), false);
});

test('weekly: per-day target, meetings, totals, % of target', () => {
  const { start, end } = C.lastWeek('2026-11-23');
  const boxes = [];
  for (let i = 0; i < 10; i++) boxes.push(box({ name: `M${i}`, created: ny('2026-11-16', 9), sent: ny('2026-11-16', 10), sentCount: 1 }));
  boxes.push(box({ name: 'S', created: ny('2026-11-01'), stage: '5003', stageAt: ny('2026-11-18'), recv: ny('2026-11-18'), sent: ny('2026-11-01') }));
  boxes.push(box({ name: 'Old', created: ny('2026-11-01'), stage: '5003', stageAt: ny('2026-11-05') }));
  const r = C.computeWeekly({ CC01: { boxes }, CC02: { boxes: [] }, CC03: { boxes: [] }, CC09: { boxes: [] } }, start, end);
  const cc01 = r.campaigns[0];
  assert.equal(cc01.newCompanies, 10);
  assert.equal(cc01.weekTarget, 70);
  assert.equal(cc01.daysOnTarget, 1);
  assert.equal(cc01.perDay[0].n, 10);
  assert.equal(cc01.meetings, 1);
  assert.equal(cc01.replies, 1);
  assert.equal(cc01.toDate.companies, 12);
  assert.equal(r.totals.target, 210);           // CC09 has no target
  assert.equal(r.pctOfTarget, 5);
  assert.equal(r.campaigns[3].weekTarget, 0);
});

test('subjects keep task numbers', () => {
  const d = C.computeDaily({ CC01: { boxes: [] }, CC02: { boxes: [] }, CC03: { boxes: [] } }, '2026-11-23');
  assert.match(C.dailySubject(d), /^❌ \[08\+41\] Campaign daily stats Nov 23: CC01 0\/10 · CC02 0\/10 · CC03 0\/10/);
  const w = C.computeWeekly({}, '2026-11-16', '2026-11-22');
  assert.match(C.weeklySubject(w), /^\[36\+38\] Outreach weekly — Nov 16–Nov 22, 2026: 0 companies/);
});

test('rendering: escapes names, shows task footer, marks unreachable source in red', () => {
  const day = '2026-11-23';
  const boxes = [box({ name: '<script>Acme & Co</script>', created: ny(day), recv: ny(day, 14), sent: ny(day, 9), sentCount: 1 })];
  const r = C.computeDaily({ CC01: { boxes }, CC02: { boxes: [], error: 'Streak 503' }, CC03: { boxes: [] } }, day);
  const html = C.renderDaily(r);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;Acme &amp; Co&lt;/script&gt;'));
  assert.ok(html.includes('Task #08 + #41'));
  assert.ok(html.includes('Streak not reachable'));
  assert.ok(!/background(-color)?:\s*#(000|111|12211d)/i.test(html), 'no dark backgrounds');
  const text = C.renderDailyText(r);
  assert.ok(text.includes('CC02: Streak not reachable'));
  const w = C.computeWeekly({ CC01: { boxes }, CC02: { boxes: [] }, CC03: { boxes: [] }, CC09: { boxes } }, '2026-11-16', '2026-11-22');
  const wh = C.renderWeekly(w);
  assert.ok(wh.includes('Task #36 + #38'));
  assert.ok(wh.includes('CC09'));
  assert.ok(C.renderWeeklyText(w).includes('Task #36 + #38'));
});

test('recipients are internal only', () => {
  assert.deepEqual(C.internalRecipients(['Report@GershonConsulting.com ']), ['report@gershonconsulting.com']);
  assert.throws(() => C.internalRecipients(['ceo@client.com']), /not internal/);
  assert.throws(() => C.internalRecipients(['x@gershonconsulting.com.evil.io']), /not internal/);
  assert.throws(() => C.internalRecipients([]), /no recipients/);
});

test('bounce days from Streak comments', () => {
  assert.deepEqual(bounceDaysFromComments({ results: [
    { message: 'Bounced a@b.com 2026-11-20', timestamp: 1 },
    { message: 'Replied 2026-11-21' },
    { message: 'bounced c@d.com', timestamp: ny('2026-11-19') },
  ] }).sort(), ['2026-11-19', '2026-11-20']);
});

test('loadCampaignBoxes + buildReport with a fake Streak', async () => {
  const day = '2026-11-23';
  const meta = (field, items) => ({ stages: { 5001: { name: '1. Contacted' } }, fields: [{ key: field, dropdownSettings: { items } }] });
  const data = {
    [`/v1/pipelines/${C.PIPELINES.gcCampaigns.key}`]: meta('1002', [{ key: 9212, name: 'CC01' }, { key: 9211, name: 'CC03' }]),
    [`/v1/pipelines/${C.PIPELINES.gcCampaigns.key}/boxes`]: [
      { boxKey: 'k1', name: 'One', stageKey: '5001', creationTimestamp: ny(day), totalNumberOfSentEmails: 1, lastEmailSentTimestamp: ny(day, 13), fields: { 1002: '9212' } },
      { boxKey: 'k2', name: 'Three', stageKey: '5001', creationTimestamp: ny(day), fields: { 1002: '9211' } },
      { boxKey: 'k3', name: 'Other', stageKey: '5001', creationTimestamp: ny(day), fields: { 1002: '9999' } },
    ],
    [`/v1/pipelines/${C.PIPELINES.gcPipeline.key}`]: meta('1003', [{ key: 9226, name: 'CC02' }]),
    [`/v1/pipelines/${C.PIPELINES.gcPipeline.key}/boxes`]: [],
  };
  const get = async (p) => {
    if (p.includes('/comments')) return { results: [] };
    if (!(p in data)) throw new Error(`Streak 404 on ${p}`);
    return data[p];
  };
  const load = await loadCampaignBoxes(get, C.DAILY_CODES, { start: day, end: day });
  assert.equal(load.byCampaign.CC01.boxes.length, 1);
  assert.equal(load.byCampaign.CC03.boxes.length, 1);
  assert.equal(load.byCampaign.CC02.boxes.length, 0);
  assert.equal(load.commentsChecked, 2);
  const rep = await buildReport('daily', day, get);
  assert.equal(rep.idem, 'campaign-daily-stats-2026-11-23');
  assert.match(rep.subject, /CC01 1\/10 · CC02 0\/10 · CC03 1\/10, 1 intros/);
  const wk = await buildReport('weekly', day, get);
  assert.equal(wk.idem, 'campaign-weekly-2026-11-16');
  assert.match(wk.r.campaigns.find((c) => c.code === 'CC09').error, /Streak 404/);
  assert.ok(wk.html.includes('Streak not reachable'));
});

test('magic columns nested or top-level; no comment lookup when commentCount is 0', () => {
  const b = C.normalizeBox({ boxKey: 'k', name: 'N', creationTimestamp: ny('2026-11-20'), magicColumns: { totalNumberOfSentEmails: 2, lastEmailSentTimestamp: ny('2026-11-21'), commentCount: 0 } }, { campaign: 'CC02', pipeline: 'gcPipeline' });
  assert.equal(b.sentCount, 2);
  assert.equal(b.lastSentDay, '2026-11-21');
  assert.equal(C.needsComments(b, '2026-11-20', '2026-11-21'), false);
  const b2 = C.normalizeBox({ boxKey: 'k2', name: 'N2', creationTimestamp: ny('2026-11-20'), commentCount: 3 }, { campaign: 'CC02', pipeline: 'gcPipeline' });
  assert.equal(C.needsComments(b2, '2026-11-20', '2026-11-21'), true);
});

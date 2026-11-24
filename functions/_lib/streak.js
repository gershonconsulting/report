// functions/_lib/streak.js
// Reads campaign boxes from the Streak API (needs env STREAK_API_KEY).
import { CAMPAIGNS, PIPELINES, normalizeBox, needsComments, nyDate } from './campaigns.js';

const COUNTRY_FIELD = { gcPipeline: '1044', gcCampaigns: '1015', gcPartners: null };
const MAX_COMMENT_LOOKUPS = 35; // Pages Functions subrequest budget

export function streakClient(apiKey, fetchImpl = fetch) {
  const auth = 'Basic ' + btoa(`${apiKey}:`);
  return async function get(path) {
    const r = await fetchImpl(`https://api.streak.com/api${path}`, { headers: { Authorization: auth } });
    if (!r.ok) throw new Error(`Streak ${r.status} on ${path.split('/').slice(0, 3).join('/')}`);
    return r.json();
  };
}

function dropdown(pipe, fieldKey) {
  const f = (pipe.fields || []).find((x) => String(x.key) === String(fieldKey));
  const items = (f && f.dropdownSettings && f.dropdownSettings.items) || [];
  return Object.fromEntries(items.map((i) => [String(i.key), i.name]));
}

// Bounce days from comments ("Bounced <address> <date>" written by the tasks).
export function bounceDaysFromComments(comments) {
  const list = Array.isArray(comments) ? comments : (comments && (comments.results || comments.comments)) || [];
  const out = new Set();
  for (const c of list) {
    const msg = String(c.message || c.text || '');
    if (!/^\s*bounced/i.test(msg)) continue;
    const m = msg.match(/(20\d\d-\d\d-\d\d)/);
    const d = m ? m[1] : nyDate(c.timestamp || c.creationTimestamp);
    if (d) out.add(d);
  }
  return [...out];
}

// Returns { CC01: {boxes, error}, ... } for the requested codes.
export async function loadCampaignBoxes(get, codes, window) {
  const wanted = CAMPAIGNS.filter((c) => codes.includes(c.code));
  const pipeIds = [...new Set(wanted.flatMap((c) => c.sources.map((s) => s.pipeline)))];
  const pipes = {};
  await Promise.all(pipeIds.map(async (id) => {
    try {
      const [meta, boxes] = await Promise.all([get(`/v1/pipelines/${PIPELINES[id].key}`), get(`/v1/pipelines/${PIPELINES[id].key}/boxes`)]);
      const stages = Object.fromEntries(Object.entries(meta.stages || {}).map(([k, v]) => [k, v.name || k]));
      pipes[id] = { meta, boxes: Array.isArray(boxes) ? boxes : boxes.results || [], stages };
    } catch (e) {
      pipes[id] = { error: e.message };
    }
  }));

  const out = {};
  const toCheck = [];
  for (const c of wanted) {
    const boxes = [];
    let error = null;
    for (const s of c.sources) {
      const p = pipes[s.pipeline];
      if (p.error) { error = p.error; continue; }
      const opts = dropdown(p.meta, s.field);
      const keys = new Set([s.option, ...Object.entries(opts).filter(([, n]) => String(n).trim().toUpperCase() === c.code).map(([k]) => k)]);
      const cf = COUNTRY_FIELD[s.pipeline];
      const countries = cf ? dropdown(p.meta, cf) : {};
      for (const raw of p.boxes) {
        if (!keys.has(String((raw.fields || {})[s.field] ?? ''))) continue;
        const b = normalizeBox(raw, { campaign: c.code, pipeline: s.pipeline, stages: p.stages, countries, countryField: cf, bounceDates: [] });
        boxes.push(b);
        if (window && needsComments(b, window.start, window.end)) toCheck.push(b);
      }
    }
    out[c.code] = { boxes, error };
  }

  let commentErrors = 0;
  const batch = toCheck.slice(0, MAX_COMMENT_LOOKUPS);
  await Promise.all(batch.map(async (b) => {
    try { b.bounceDates = bounceDaysFromComments(await get(`/v2/boxes/${encodeURIComponent(b.key)}/comments`)); }
    catch { commentErrors += 1; }
  }));
  return { byCampaign: out, commentsChecked: batch.length, commentsSkipped: toCheck.length - batch.length, commentErrors };
}

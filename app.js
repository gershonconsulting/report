/* ============================================================
   Gershon Consulting — One-Pager Generator
   Reads the monthly exports, derives the analysis, writes the page.
   Everything runs in the browser. No file leaves the machine.
   ============================================================ */
(function () {
  'use strict';

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ---------------- tiny helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var num = function (v) {
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(/[, ]/g, ''));
    return isFinite(n) ? n : null;
  };
  var fmt = function (n) { return n == null ? '—' : n.toLocaleString('en-US'); };
  var pct = function (n, d) { return (d ? (n / d) * 100 : 0); };
  var r1 = function (n) { return Math.round(n * 10) / 10; };
  var has = function (n) { return n != null && isFinite(n); };
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  /* ============================================================
     1. PDF → text, with reading order reconstructed
     ============================================================ */
  function readPdf(file) {
    return file.arrayBuffer().then(function (buf) {
      return pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pages = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (p) {
          chain = chain.then(function () {
            return pdf.getPage(p).then(function (page) {
              return page.getTextContent().then(function (tc) {
                var items = tc.items.filter(function (it) { return it.str && it.str.trim(); })
                  .map(function (it) { return { x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str }; });
                pages.push({ items: items, text: itemsToLines(items) });
              });
            });
          });
        })(i);
      }
      return chain.then(function () {
        return { pages: pages, text: pages.map(function (p) { return p.text; }).join('\n') };
      });
    });
  }

  // Join the runs of one visual line back into text. A ligature cluster is a
  // word the PDF split into styled runs ("P|fi|zer") and must be glued; a wide
  // gap is a column break; anything above a hair is an ordinary word break.
  function joinParts(parts, marksColumns) {
    var out = '', last = null, prevLig = false;
    parts.forEach(function (p) {
      var lig = LIGATURE.test(p.s);
      if (last !== null && !/ $/.test(out)) {
        var gap = p.x - last;
        if ((lig || prevLig) && gap < 6) { /* glue */ }
        else if (marksColumns && gap > 10) out += '  ';
        else if (gap > 1.6) out += ' ';
      }
      out += p.s; last = p.x + (p.w || p.s.length * 4.2); prevLig = lig;
    });
    return out;
  }

  function itemsToLines(items) {
    return yRows(items).map(function (r) {
      return joinParts(r.parts, true).replace(/[ \t]{3,}/g, '  ').replace(/^\s+|\s+$/g, '');
    }).filter(Boolean).join('\n');
  }

  var LIGATURE = /^(fi|fl|ff|ffi|ffl)$/;
  function yRows(items) {
    var rows = [];
    items.forEach(function (it) {
      var y = Math.round(it.y * 2) / 2, row = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) <= 2.6) { row = rows[i]; break; }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: it.x, s: it.s, w: it.w });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    rows.forEach(function (r) { r.parts.sort(function (a, b) { return a.x - b.x; }); });
    return rows;
  }

  /* ============================================================
     2. Parsers
     ============================================================ */
  function classify(text) {
    if (/OPPORTUNITIES\s+GENERATED|MONTHLY\s*C\s*A\s*M\s*P|Conversion funnel|Connections sent/i.test(text)) return 'campaign';
    if (/Social Networking Content|LinkedIn Performance Overview|What worked best\?/i.test(text)) return 'narrative';
    if (/Audience Growth|Engagement Breakdown|Total Followers|Top Hashtags/i.test(text)) return 'social';
    return 'unknown';
  }

  function flat(text) { return String(text || '').replace(/[ \t]{2,}/g, ' '); }
  function lines(text) { return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }

  function findLine(L, re, from) {
    for (var i = from || 0; i < L.length; i++) if (re.test(L[i])) return i;
    return -1;
  }
  function after(L, re, n) { var i = findLine(L, re); return i < 0 ? null : (L[i + (n || 1)] || null); }
  function ints(s) {
    var m = String(s || '').match(/\d[\d,]*/g);
    return m ? m.map(function (x) { return parseInt(x.replace(/,/g, ''), 10); }) : [];
  }
  function deltas(s) {
    var m = String(s || '').match(/no change|[+-]\s?\d+(?:\.\d+)?%/gi);
    return m ? m.map(function (x) { return /no change/i.test(x) ? 0 : parseFloat(x.replace(/\s/g, '')); }) : [];
  }
  // The change line can split across two visual rows; gather across a short window.
  function deltaWindow(L, from, span) {
    var out = [];
    for (var i = from; i < Math.min(L.length, from + (span || 4)); i++) {
      if (/vs last month|no change|previous period/i.test(L[i]) || /%/.test(L[i])) {
        deltas(L[i]).forEach(function (d) { out.push(d); });
      }
    }
    return out;
  }

  function parseCampaign(text, D, pages) {
    var L = lines(text);

    var NT = flat(text);
    var am = text.match(/Account Manager:?\s*([^\n]{2,60})/);
    if (am) {
      var a = am[1].split(/\s{2,}/)[0].trim().replace(/[|·,;].*$/, '').trim();
      a = a.split(/\s+/).slice(0, 4).join(' ');
      if (a) D.accountManager = a;
    }

    var per = NT.match(new RegExp('(' + MONTHS.join('|') + ')\\s+(20\\d\\d)', 'i'));
    if (per) {
      D.periodLabel = cap(per[1]) + ' ' + per[2];
      var mi = MONTHS.findIndex(function (m) { return m.toLowerCase() === per[1].toLowerCase(); });
      var yr = +per[2];
      D.periodStart = new Date(Date.UTC(yr, mi, 1)).toISOString().slice(0, 10);
      D.periodEnd = new Date(Date.UTC(yr, mi + 1, 0)).toISOString().slice(0, 10);
    }

    // Client name: the title sitting above (or beside) the period / account-manager line.
    var ai = findLine(L, /Account Manager/i);
    if (ai < 0) ai = findLine(L, new RegExp('(' + MONTHS.join('|') + ')\\s+20\\d\\d', 'i'));
    for (var i = ai; i >= 0 && i > ai - 8; i--) {
      var c = (L[i] || '').split(/\s{2,}/)[0]                 // first column only
        .replace(new RegExp('(' + MONTHS.join('|') + ')\\s+20\\d\\d', 'ig'), '')
        .replace(/Account Manager.*$/i, '')
        .replace(/[+\-]?\d[\d,.]*%?/g, '').replace(/\s+/g, ' ').trim();
      if (!c || c.length < 2 || c.length > 60) continue;
      if (/^(M\s*O\s*N|MONTHLY|CAMPAIGN|REPORT|OPPORTUNITIES|GENERATED|vs last|Key takeaways|AT A GLANCE)/i.test(c)) continue;
      if (!/[A-Za-z]{2}/.test(c)) continue;
      D.client = c; break;
    }

    // Conversion funnel — the least ambiguous source for the four core counts.
    var fi = findLine(L, /Conversion funnel/i);
    if (fi >= 0) {
      var blk = L.slice(fi, fi + 14).join('\n');
      var g = function (re) { var m = blk.match(re); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
      D.sent = g(/Connections sent\s+(\d[\d,]*)/i);
      D.accepted = g(/Accepted\s+(\d[\d,]*)/i);
      D.messages = g(/Conversations\s+(\d[\d,]*)/i);
      D.opportunities = g(/Opportunities\s+(\d[\d,]*)/i);
    }

    // AT A GLANCE — values plus month-on-month change.
    var gi = findLine(L, /Connections sent[\s\S]*Acceptances/i);
    if (gi >= 0) {
      var v = ints(L[gi + 1]), d = deltaWindow(L, gi + 2, 3);
      if (v.length >= 4) {
        var five = v.length >= 5;
        if (D.sent == null) D.sent = v[0];
        if (D.accepted == null) D.accepted = v[1];
        if (D.messages == null) D.messages = v[five ? 3 : 2];
        if (D.opportunities == null) D.opportunities = v[five ? 4 : 3];
      }
      if (d.length >= 4) { D.dSent = d[0]; D.dAccepted = d[1]; D.dMessages = d[2]; D.dOpportunities = d[3]; }
    }
    var hi = findLine(L, /Follow-ups[\s\S]*InMails/i);
    if (hi >= 0) {
      var v2 = ints(L[hi + 1]), d2 = deltaWindow(L, hi + 2, 3);
      if (v2.length >= 2) { D.followups = v2[0]; D.inmails = v2[1]; }
      if (d2.length >= 2) { D.dFollowups = d2[0]; D.dInmails = d2[1]; }
    }
    if (D.opportunities == null) {
      var oh = findLine(L, /OPPORTUNITIES\s+GENERATED/i);
      if (oh >= 0) { var ov = ints(L[oh + 1]); if (ov.length) D.opportunities = ov[0]; }
    }
    if (D.dOpportunities == null) {
      var oh2 = findLine(L, /OPPORTUNITIES\s+GENERATED/i);
      if (oh2 >= 0) { var od = deltaWindow(L, oh2 + 1, 3); if (od.length) D.dOpportunities = od[0]; }
    }

    var leads = pages ? leadTable(pages) : [];
    if (leads.length) D.leads = leads;

    var cs = [], seen = {};
    var ci = findLine(L, /Of opportunities where size was recorded/i);
    if (ci >= 0) {
      var sblk = L.slice(ci + 1, ci + 16).join('\n');
      var sre = /(\d[\d,]*(?:[-–]\d[\d,]*|\+))\s+(\d+)(?![\d%])/g, sm;
      while ((sm = sre.exec(sblk))) {
        var lab = sm[1].replace('–', '-');
        if (!seen[lab]) { seen[lab] = 1; cs.push({ label: lab, value: +sm[2] }); }
      }
    }
    if (cs.length) D.companySize = cs;

    var mixI = findLine(L, /Type of lead generated|Opportunity mix/i);
    if (mixI >= 0) {
      var mblk = L.slice(mixI, mixI + 14).join('\n'), mix = [], mseen = {};
      var mre = /(Email Requested|Email Request|Call Request|Call Requested|Meeting|Demo Request|Demo|Referral|Introduction|Interested)\s+(\d+)(?![\d%])/gi, mm2;
      while ((mm2 = mre.exec(mblk))) {
        var ml = mm2[1].replace(/\bEmail Request\b/i, 'Email requested').replace(/\bCall Requested\b/i, 'Call request');
        ml = ml.charAt(0).toUpperCase() + ml.slice(1).toLowerCase();
        if (!mseen[ml]) { mseen[ml] = 1; mix.push({ label: ml, value: +mm2[2] }); }
      }
      if (mix.length) D.leadTypes = mix;
    }
    return D;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  /* Column-aware extraction of the "Opportunities" table.
     The header row fixes the column boundaries; a row closes when the Date
     column receives a value, which is what every record ends with. */
  var LEAD_DATE = /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+20\d\d$/i;
  function leadTable(pages) {
    var HEADS = ['name', 'job title', 'company', 'industry', 'country', 'account', 'date', 'profile'];
    var FOOTNOTE = /LinkedIn activity totals|are summed across|weekly performance entries|^Page \d/i;
    var out = [];
    pages.forEach(function (pg) {
      var rows = yRows(pg.items), hIdx = -1, cols = null;
      for (var i = 0; i < rows.length; i++) {
        var parts = rows[i].parts.map(function (p) { return p.s.trim().toLowerCase(); });
        if (parts.indexOf('name') < 0 || parts.indexOf('company') < 0 || parts.indexOf('date') < 0) continue;
        cols = [];
        rows[i].parts.forEach(function (p) {
          var t = p.s.trim().toLowerCase();
          if (HEADS.indexOf(t) >= 0) cols.push({ key: t, x: p.x });
        });
        if (cols.length >= 5) { hIdx = i; break; }
        cols = null;
      }
      if (hIdx < 0 || !cols) return;
      cols.sort(function (a, b) { return a.x - b.x; });
      var colAt = function (x) {
        var k = cols[0].key;
        for (var c = 0; c < cols.length; c++) if (x >= cols[c].x - 6) k = cols[c].key;
        return k;
      };

      var body = rows.slice(hIdx + 1).filter(function (r) {
        return !FOOTNOTE.test(r.parts.map(function (p) { return p.s; }).join(' '));
      });
      if (body.length < 2) return;

      // Lines inside one record sit a single leading apart; records are
      // separated by a much larger gap. Derive the split from the page itself.
      var gaps = [];
      for (var g = 1; g < body.length; g++) {
        var dy = body[g - 1].y - body[g].y;
        if (dy > 0.6) gaps.push(dy);
      }
      if (!gaps.length) return;
      var sorted = gaps.slice().sort(function (a, b) { return a - b; });
      var median = sorted[Math.floor(sorted.length / 2)];
      var split = Math.max(median * 2, median + 4);

      var groups = [[]], prevY = null;
      body.forEach(function (r) {
        if (prevY !== null && prevY - r.y > split) groups.push([]);
        groups[groups.length - 1].push(r);
        prevY = r.y;
      });

      groups.forEach(function (grp) {
        var acc = {};
        grp.forEach(function (r) {
          var byCol = {};
          r.parts.forEach(function (p) {
            var t = p.s.trim();
            if (!t || t.toLowerCase() === 'view') return;
            var k = colAt(p.x);
            (byCol[k] = byCol[k] || []).push(p);
          });
          Object.keys(byCol).forEach(function (k) {
            var txt = joinParts(byCol[k], false).trim();
            if (txt) acc[k] = (acc[k] ? acc[k] + ' ' : '') + txt;
          });
        });
        var iso = isoDate(clean(acc.date));
        if (!acc.date || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
        var rec = {
          name: clean(acc.name), title: clean(acc['job title']), company: clean(acc.company),
          industry: clean(acc.industry), location: clean(acc.country), date: iso, type: ''
        };
        if (rec.name || rec.company) out.push(rec);
      });
    });
    return out;
  }

  function clean(s) { return (s || '').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, ''); }
  function isoDate(s) {
    var m = (s || '').match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(20\d\d)/);
    if (!m) return s || '';
    var mi = MONTHS.findIndex(function (x) { return x.toLowerCase().indexOf(m[2].toLowerCase().slice(0, 3)) === 0; });
    if (mi < 0) return s;
    return m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0');
  }

  function parseSocial(text, D) {
    var L = lines(text), NT = flat(text);

    // Metrics are laid out as a header row of labels, then "N/A" placeholders,
    // then the real values. Read the pair together so column order is preserved.
    function pair(reA, reB, keyA, keyB) {
      var i = findLine(L, reA);
      if (i < 0) return;
      var both = reB.test(L[i]);
      for (var j = i; j < Math.min(L.length, i + 9); j++) {
        var v = ints(L[j].replace(/20\d\d/g, '')).filter(function (n) { return n > 0; });
        if (!v.length) continue;
        if (D[keyA] == null) D[keyA] = v[0];
        if (keyB && D[keyB] == null && (both ? v.length > 1 : true)) {
          if (both && v.length > 1) D[keyB] = v[1];
          else if (!both) {
            var k = findLine(L, reB, i);
            if (k >= 0) for (var q = k; q < Math.min(L.length, k + 9); q++) {
              var w = ints(L[q].replace(/20\d\d/g, '')).filter(function (n) { return n > 0; });
              if (w.length) { D[keyB] = w[0]; break; }
            }
          }
        }
        return;
      }
    }
    pair(/Total Followers/i, /Followers Gained/i, 'followers', 'followersGained');
    pair(/^Impressions\b/i, /Reach/i, 'impressions', 'reach');

    var oi = findLine(L, /^Overall\b/i);
    if (oi >= 0) {
      var vals = [];
      for (var j = oi; j < Math.min(L.length, oi + 10); j++) {
        var got = L[j].match(/\b\d[\d,]*\b/g);
        if (got) got.forEach(function (n) { vals.push(parseInt(n.replace(/,/g, ''), 10)); });
        if (vals.length >= 3) break;
      }
      if (vals.length) {
        if (D.engagements == null) D.engagements = vals[0];
        if (vals.length > 1 && D.reactions == null) D.reactions = vals[1];
        if (vals.length > 2 && D.comments == null) D.comments = vals[2];
      }
    }
    var pi = findLine(L, /^This Period$/i);
    if (pi >= 0) {
      var pv = [];
      for (var p = pi + 1; p < Math.min(L.length, pi + 12); p++) ints(L[p]).forEach(function (n) { pv.push(n); });
      if (pv.length && D.posts == null) D.posts = pv[0];
      if (pv.length > 1 && D.likes == null) D.likes = pv[1];
    }

    // "0.0% more engaging" appears in the hashtag panel too — take the real lift.
    var lifts = (NT.match(/This post type is\s+([\d.]+)%\s+more engaging/ig) || [])
      .map(function (m) { return parseFloat(m.replace(/[^\d.]/g, '')); }).filter(function (n) { return n > 0; });
    if (lifts.length) D.formatLift = Math.max.apply(null, lifts);

    var fm = NT.match(/(Short text posts|Image posts[^.]{0,80}?|Video posts|Link posts|Document posts)\s+perform better than any other post type/i);
    if (fm) D.bestFormat = fm[1].trim().replace(/^./, function (c) { return c.toUpperCase(); });
    var win = NT.match(/Between\s+(\d{1,2})\s?([AP]M)\s+and\s+(\d{1,2})\s?([AP]M)\s*\(?([A-Z]{2,3})?\)?\s+is the optimal post time/i);
    if (win) D.bestWindow = win[1] + ' ' + win[2].toUpperCase() + ' – ' + win[3] + ' ' + win[4].toUpperCase() + (win[5] ? ' ' + win[5].toUpperCase() : '');
    var sample = NT.match(/You've posted this type of content\s+(\d+)\s+times? since\s+([A-Za-z]+ \d{1,2}, 20\d\d)/i);
    if (sample) D.contentCaveat = 'Format and timing read from ' + sample[1] + ' posts since ' + sample[2]
      + ' — a strong indication to test against, not yet a settled rule.';

    var mv = findLine(L, /^Most Viewed Hashtags/i);
    if (mv >= 0) {
      var tags = [];
      for (var h = mv + 1; h < Math.min(L.length, mv + 12); h++) {
        var t = L[h].match(/^#([A-Za-z0-9_]+)/);
        if (t && tags.indexOf('#' + t[1]) < 0) tags.push('#' + t[1]);
      }
      if (tags.length) D.hashtags = tags.slice(0, 4).join(', ');
    }

    // Top posts: a "Mon D, YYYY, h:mma" header, then body text, then a
    // numeric block reading likes / comments / engagements / impressions.
    var posts = [];
    var head = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, 20\d\d),?\s+(\d{1,2}:\d{2}\s?[ap]m)/i;
    for (var s2 = 0; s2 < L.length; s2++) {
      if (!head.test(L[s2])) continue;
      var mm = L[s2].match(head), body = [], stats = [];
      for (var b = s2 + 1; b < Math.min(L.length, s2 + 40); b++) {
        var ln = L[b];
        if (head.test(ln)) break;
        if (/^https?:|pdf-report|app\.cloudcampaign/i.test(ln)) continue;
        if (/^[\d.,\s]*k?$/i.test(ln.replace(/\s+/g, ' ')) && /\d/.test(ln)) {
          (ln.match(/[\d.,]+k?/gi) || []).forEach(function (t2) { stats.push(t2); });
          continue;
        }
        if (ln.length > 20 && body.length < 2) body.push(ln);
      }
      var toN = function (v) {
        if (!v) return null;
        return /k$/i.test(v) ? Math.round(parseFloat(v) * 1000) : parseInt(String(v).replace(/,/g, ''), 10);
      };
      posts.push({
        date: mm[1], text: postText(body.join(' ')),
        likes: toN(stats[0]), comments: toN(stats[1]),
        engagements: toN(stats[2]), impressions: toN(stats[3])
      });
      if (posts.length >= 3) break;
    }
    if (posts.length) D.topPosts = posts;
    return D;
  }

  function postText(t) {
    return (t || '').replace(/\(https?:\/\/[^)]*\)/g, ' ')
      .replace(/@\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/^(.{0,150})(\s|$).*/s, function (m, keep) {
        return keep + (m.length > keep.length ? '…' : '');
      });
  }

  function parseNarrative(text, D) {
    var NT = flat(text);
    var g = function (re) { var m = NT.match(re); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
    D.followers = D.followers || g(/reached\s+([\d,]+)\s+followers/i);
    D.followersGained = D.followersGained || g(/with\s+([\d,]+)\s+new followers/i);
    D.impressions = D.impressions || g(/([\d,]+)\s+impressions/i);
    D.reach = D.reach || g(/reached\s+([\d,]+)\s+people/i);
    D.engagements = D.engagements || g(/([\d,]+)\s+overall engagements/i);
    D.reactions = D.reactions || g(/([\d,]+)\s+reactions/i);
    D.posts = D.posts || g(/A total of\s+([\d,]+)\s+posts/i);
    D.likes = D.likes || g(/generating\s+([\d,]+)\s+likes/i);
    var c = NT.match(/([\d,]+)\s+comments/i); if (c && D.comments == null) D.comments = parseInt(c[1].replace(/,/g, ''), 10);
    return D;
  }

  /* ============================================================
     3. Data model
     ============================================================ */
  function blank() {
    return {
      client: '', periodLabel: '', periodStart: '', periodEnd: '',
      accountManager: '', preparedBy: 'Gershon Consulting', logo: '',
      sent: null, accepted: null, messages: null, followups: null, inmails: null, opportunities: null,
      dSent: null, dAccepted: null, dMessages: null, dFollowups: null, dInmails: null, dOpportunities: null,
      followers: null, followersGained: null, impressions: null, reach: null,
      engagements: null, reactions: null, comments: null, shares: null, posts: null, likes: null,
      bestFormat: '', formatLift: null, bestWindow: '', hashtags: '', contentCaveat: '',
      topPosts: [], leads: [], companySize: [], leadTypes: [], sources: ''
    };
  }

  var SAMPLE = {
    client: 'Enzymicals AG', periodLabel: 'August 2026',
    periodStart: '2026-08-01', periodEnd: '2026-08-31',
    accountManager: 'Nicolette Jones', preparedBy: 'Gershon Consulting', logo: '',
    sent: 624, accepted: 201, messages: 187, followups: 233, inmails: 62, opportunities: 11,
    dSent: 5, dAccepted: 49, dMessages: 47, dFollowups: 108, dInmails: -67, dOpportunities: 83,
    followers: 4926, followersGained: 88, impressions: 16638, reach: 9330,
    engagements: 1548, reactions: 422, comments: 7, shares: 0, posts: 24, likes: 239,
    bestFormat: 'Short text posts', formatLift: 165.6, bestWindow: '9 AM – 12 PM ET',
    hashtags: '#BIOCAT2026, #Biotechnology, #Enzymicals, #Networking',
    contentCaveat: 'Format and timing read from 4 posts since 1 July 2026 — a strong indication to test against, not yet a settled rule.',
    topPosts: [
      { date: '28 Aug', text: 'BIOCAT 2026 congress recap — thanks to organisers, customers and partners', impressions: 2400, engagements: 877, likes: 77, comments: 2 },
      { date: '17 Aug', text: '“We’re looking forward to BIOCAT 2026” — Philipp Süss and Christin Peters at the booth', impressions: 1600, engagements: 76, likes: 23, comments: 4 },
      { date: '25 Aug', text: 'Open invitation — bring your biocatalysis problem to the booth', impressions: 1200, engagements: 59, likes: 27, comments: 0 }
    ],
    leads: [
      { name: 'Mark Drew', title: 'Director of Drug Discovery & Development', company: 'Critical Path Institute', industry: 'Research Services', location: 'Tucson, AZ', date: '2026-08-03', type: 'Meeting' },
      { name: 'Vishwas Bhatia', title: 'Director, Analytical Research & Development', company: 'Ocugen', industry: 'Biotechnology Research', location: 'New York Metro', date: '2026-08-03', type: 'Email requested' },
      { name: 'Anthony Sandrasagra', title: 'Chief Scientific Officer', company: 'Stealth Biotech', industry: 'Biotechnology Research', location: 'Arlington, MA', date: '2026-08-06', type: 'Email requested' },
      { name: 'Kevin Leach', title: 'SVP, Scientific & Regulatory Affairs', company: 'Avance Clinical', industry: 'Biotechnology Research', location: 'Lexington, MA', date: '2026-08-17', type: 'Call request' },
      { name: 'Roger Howard', title: 'Research Fellow & Head of Applied Synthesis Technologies', company: 'Pfizer', industry: 'Chemical Manufacturing', location: 'Mystic, CT', date: '2026-08-18', type: 'Email requested' },
      { name: 'Ashley Buchanan', title: 'Senior Process Development Chemist', company: 'Ingevity', industry: 'Chemical Manufacturing', location: 'Charleston, SC', date: '2026-08-20', type: 'Call request' },
      { name: 'Maryam Taherzadeh', title: 'AI in Drug Discovery Research Fellow', company: 'Algoverse', industry: 'Chemical Manufacturing', location: 'SF Bay Area', date: '2026-08-20', type: 'Email requested' },
      { name: 'Timothy Martin', title: 'Associate Director, Process Chemistry', company: 'Incyte', industry: 'Biotechnology Research', location: 'Philadelphia Metro', date: '2026-08-24', type: 'Email requested' },
      { name: 'Rich Christie', title: 'Clinical Development Consultant', company: 'Vima Therapeutics', industry: 'Biotechnology Research', location: 'New York Metro', date: '2026-08-26', type: 'Meeting' },
      { name: 'Lanqi Huang', title: 'Senior Scientist 2 — Chemical R&D', company: 'Cambrex', industry: 'Chemical Manufacturing', location: 'United States', date: '2026-08-27', type: 'Call request' },
      { name: 'Michael Simson', title: 'General Manager, Head of Business Development', company: 'Advy Biosciences', industry: 'Biotechnology Research', location: 'Boise Metro', date: '2026-08-31', type: 'Email requested' }
    ],
    leadTypes: [
      { label: 'Email requested', value: 6 }, { label: 'Call request', value: 3 }, { label: 'Meeting', value: 2 }
    ],
    companySize: [
      { label: '51-200', value: 3 }, { label: '201-500', value: 3 },
      { label: '1,001-5,000', value: 2 }, { label: '10,001+', value: 2 }, { label: '11-50', value: 1 }
    ],
    sources: 'Monthly Campaign Report (Sales Navigator outbound); social analytics export (Cloud Campaign); monthly written narrative. LinkedIn activity totals are summed across the weekly performance entries falling within the month. Top-post impression figures are reported to the nearest hundred by the platform.'
  };

  var DATA = blank();
  var FOUND = {};   // which fields came out of the files
  var FILES = [];

  /* ============================================================
     4. Derived analysis
     ============================================================ */
  function businessDays(a, b) {
    if (!a || !b) return null;
    var d = new Date(a + 'T00:00:00Z'), e = new Date(b + 'T00:00:00Z'), n = 0;
    if (isNaN(d) || isNaN(e) || e < d) return null;
    while (d <= e) { var w = d.getUTCDay(); if (w > 0 && w < 6) n++; d.setUTCDate(d.getUTCDate() + 1); }
    return n;
  }
  function prevFrom(v, d) { return (has(v) && has(d) && d > -100) ? v / (1 + d / 100) : null; }

  function seniority(title) {
    var t = (title || '').toLowerCase();
    if (/\bchief\b|^c[teofs]o\b|\bcso\b|\bcto\b|\bceo\b|\bcfo\b|\bcmo\b|founder|president(?!.*vice)/.test(t)) return 'C-level & founder';
    if (/\bvp\b|vice president|\bsvp\b|\bevp\b|head of/.test(t)) return 'VP & Head of';
    if (/director|principal/.test(t)) return 'Director';
    return 'Senior specialist';
  }
  var SEN_ORDER = ['C-level & founder', 'VP & Head of', 'Director', 'Senior specialist'];

  function tally(arr, key) {
    var m = {};
    arr.forEach(function (o) { var k = (typeof key === 'function' ? key(o) : o[key]) || 'Not recorded'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; })
      .sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
  }

  function analyse(D) {
    var A = { d: D };
    A.leads = (D.leads || []).filter(function (l) { return l && (l.name || l.company); });
    A.nLeads = A.leads.length;
    A.opps = has(D.opportunities) ? D.opportunities : (A.nLeads || null);

    A.acceptRate = has(D.accepted) && has(D.sent) ? pct(D.accepted, D.sent) : null;
    A.convRate = has(D.messages) && has(D.accepted) ? pct(D.messages, D.accepted) : null;
    A.oppOfConv = has(A.opps) && has(D.messages) ? pct(A.opps, D.messages) : null;
    A.oppOfSent = has(A.opps) && has(D.sent) ? pct(A.opps, D.sent) : null;
    A.sentPerOpp = has(A.opps) && has(D.sent) && A.opps ? D.sent / A.opps : null;
    A.acceptedPerOpp = has(A.opps) && has(D.accepted) && A.opps ? D.accepted / A.opps : null;

    A.bizDays = businessDays(D.periodStart, D.periodEnd);
    A.paceDays = (A.bizDays && A.opps) ? A.bizDays / A.opps : null;

    A.engRate = has(D.engagements) && has(D.impressions) && D.impressions ? pct(D.engagements, D.impressions) : null;
    A.imprPerPost = has(D.impressions) && has(D.posts) && D.posts ? D.impressions / D.posts : null;
    A.reachMult = has(D.reach) && has(D.followers) && D.followers ? D.reach / D.followers : null;
    A.followerGrowth = has(D.followersGained) && has(D.followers) && D.followers > D.followersGained
      ? pct(D.followersGained, D.followers - D.followersGained) : null;

    A.industry = tally(A.leads, 'industry');
    A.geography = tally(A.leads, 'location');
    var perLead = tally(A.leads.filter(function (l) { return l.type; }), 'type');
    A.leadType = perLead.length ? perLead : (D.leadTypes || []).slice();
    A.seniorityMix = SEN_ORDER.map(function (s) {
      return { label: s, value: A.leads.filter(function (l) { return seniority(l.title) === s; }).length };
    }).filter(function (o) { return o.value > 0; });
    A.companies = Object.keys(A.leads.reduce(function (m, l) { if (l.company) m[l.company] = 1; return m; }, {})).length;
    A.titles = Object.keys(A.leads.reduce(function (m, l) { if (l.title) m[l.title] = 1; return m; }, {})).length;
    A.companySize = (D.companySize || []).slice();

    // month-on-month, reconstructed from the reported percentage changes
    A.mom = [
      { label: 'Connections', now: D.sent, prev: prevFrom(D.sent, D.dSent), d: D.dSent },
      { label: 'Acceptances', now: D.accepted, prev: prevFrom(D.accepted, D.dAccepted), d: D.dAccepted },
      { label: 'Conversations', now: D.messages, prev: prevFrom(D.messages, D.dMessages), d: D.dMessages },
      { label: 'Follow-ups', now: D.followups, prev: prevFrom(D.followups, D.dFollowups), d: D.dFollowups },
      { label: 'InMails', now: D.inmails, prev: prevFrom(D.inmails, D.dInmails), d: D.dInmails },
      { label: 'Opportunities', now: A.opps, prev: prevFrom(A.opps, D.dOpportunities), d: D.dOpportunities }
    ].filter(function (o) { return has(o.now) && has(o.prev); });

    // cumulative + weekly pace, from the dated lead list
    A.dated = A.leads.filter(function (l) { return parseDate(l.date); })
      .map(function (l) { return { t: parseDate(l.date), lead: l }; })
      .sort(function (a, b) { return a.t - b.t; });
    A.weekly = weeklyBuckets(A.dated, D.periodStart, D.periodEnd);

    A.efficiencyGap = (has(D.dOpportunities) && has(D.dSent)) ? D.dOpportunities - D.dSent : null;
    return A;
  }

  function parseDate(s) {
    if (!s) return null;
    var t = Date.parse(s.length <= 10 && /^\d{4}-/.test(s) ? s + 'T00:00:00Z' : s);
    return isFinite(t) ? new Date(t) : null;
  }
  function weeklyBuckets(dated, start, end) {
    if (!start || !end || !dated.length) return [];
    var s = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z'), out = [];
    var cur = new Date(s);
    while (cur <= e) {
      var stop = new Date(cur); stop.setUTCDate(stop.getUTCDate() + 6);
      if (stop > e) stop = new Date(e);
      out.push({
        from: new Date(cur), to: new Date(stop),
        n: dated.filter(function (x) { return x.t >= cur && x.t <= stop; }).length
      });
      cur = new Date(stop); cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }
  function dm(d) { return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3); }

  /* ============================================================
     5. Conclusions — rules over the analysis, never invented
     ============================================================ */
  function conclusions(A) {
    var D = A.d, out = [];

    if (has(A.efficiencyGap) && A.efficiencyGap > 10) {
      out.push({
        fig: (D.dOpportunities > 0 ? '+' : '') + r1(D.dOpportunities) + '%', sub: 'output',
        h: 'The month got more efficient, not just busier',
        p: 'Opportunities rose ' + r1(D.dOpportunities) + '% on ' + r1(D.dSent) + '% more outreach. The same machine produced materially more, which is a targeting and messaging gain rather than a volume one.'
      });
    }
    if (has(A.convRate) && A.convRate >= 75) {
      out.push({
        fig: Math.round(A.convRate) + '%', sub: 'reply rate',
        h: 'Getting a reply is not the bottleneck',
        p: Math.round(A.convRate) + '% of everyone who accepted went on to have a conversation. The costly step in outbound is normally the reply — here the leverage sits further down, in turning conversations into opportunities.'
      });
    }
    if (has(A.acceptRate) && A.acceptRate >= 25) {
      out.push({
        fig: Math.round(A.acceptRate) + '%', sub: 'accepted',
        h: 'The target list is being recognised',
        p: 'An acceptance rate of ' + Math.round(A.acceptRate) + '% on ' + fmt(D.sent) + ' requests says the people being approached see a reason to connect — the list and the opening line are landing.'
      });
    }
    if (has(A.paceDays) && A.paceDays > 0) {
      out.push({
        fig: r1(A.paceDays), sub: 'days',
        h: 'A new opportunity roughly every ' + r1(A.paceDays) + ' working days',
        p: fmt(A.opps) + ' opportunities across ' + A.bizDays + ' working days — a steady cadence rather than one lucky week, which is what makes the next month forecastable.'
      });
    }
    if (A.industry.length) {
      var top2 = A.industry.slice(0, 2), s2 = top2.reduce(function (a, b) { return a + b.value; }, 0);
      if (A.nLeads && s2 / A.nLeads >= 0.6) {
        out.push({
          fig: s2 + '/' + A.nLeads, sub: 'concentrated',
          h: top2.map(function (t) { return t.label; }).join(' and ') + ' carried the month',
          p: s2 + ' of ' + A.nLeads + ' opportunities came from ' + (top2.length > 1 ? 'these two sectors' : 'this sector') + '. That is a clear signal to narrow the list rather than widen it.'
        });
      }
    }
    if (A.seniorityMix.length) {
      var senior = A.seniorityMix.filter(function (s) { return s.label !== 'Senior specialist'; })
        .reduce(function (a, b) { return a + b.value; }, 0);
      if (senior >= Math.ceil(A.nLeads * 0.5)) {
        out.push({
          fig: senior + '/' + A.nLeads, sub: 'decision level',
          h: 'Conversations are happening at decision level',
          p: senior + ' of ' + A.nLeads + ' opportunities are with directors, heads of function or C-level — people who can start a project rather than only recommend one.'
        });
      }
    }
    if (has(A.engRate)) {
      var strong = A.engRate >= 5;
      out.push({
        fig: r1(A.engRate) + '%', sub: 'engagement',
        h: strong ? 'The page is punching above its size' : 'Content reach is steady',
        p: 'An engagement rate of ' + r1(A.engRate) + '% of impressions (clicks included) against ' + fmt(D.impressions) + ' impressions'
          + (strong ? ' sits well clear of the low single digits typical of company pages.' : ' gives a solid baseline to build the next month against.')
      });
    }
    if (has(A.reachMult) && A.reachMult > 1.1) {
      out.push({
        fig: r1(A.reachMult) + '×', sub: 'the audience',
        h: 'Content travelled past the follower base',
        p: fmt(D.reach) + ' people saw the page against ' + fmt(D.followers) + ' followers — ' + r1(A.reachMult) + '× the audience, so the content is being carried by shares and the feed, not just served to existing followers.'
      });
    }
    if (has(D.dInmails) && D.dInmails < -25 && has(D.dFollowups) && D.dFollowups > 25) {
      out.push({
        fig: (D.dFollowups > 0 ? '+' : '') + r1(D.dFollowups) + '%', sub: 'follow-ups',
        h: 'Effort moved from cold InMail to persistence',
        p: 'InMails fell ' + Math.abs(r1(D.dInmails)) + '% while follow-ups rose ' + r1(D.dFollowups) + '%. Working the connections already made is proving cheaper than buying new cold reach.'
      });
    }
    if (A.companies && A.companies >= Math.max(2, A.nLeads - 1)) {
      out.push({
        fig: A.companies, sub: 'companies',
        h: 'No single-account concentration risk',
        p: A.nLeads + ' opportunities spread across ' + A.companies + ' different companies — the pipeline is not resting on one relationship.'
      });
    }
    return out.slice(0, 6);
  }

  function nextActions(A) {
    var D = A.d, out = [];
    var warm = A.leadType.filter(function (t) { return /email|call/i.test(t.label); })
      .reduce(function (a, b) { return a + b.value; }, 0);
    if (warm > 0) {
      out.push({
        idx: 'First', h: 'Convert what is already open',
        p: warm + ' of the ' + A.nLeads + ' contacts asked for something specific — an email or a call. Those need a reply inside 48 hours naming a real process problem, not a company overview.'
      });
    } else if (A.nLeads) {
      out.push({
        idx: 'First', h: 'Work the ' + A.nLeads + ' before adding more',
        p: 'Every opportunity logged this month is still warm. A named, specific follow-up now is worth more than another week of new outreach.'
      });
    }
    if (A.industry.length) {
      var top2 = A.industry.slice(0, 2), s2 = top2.reduce(function (a, b) { return a + b.value; }, 0);
      out.push({
        idx: 'Then', h: 'Concentrate on the sectors that yielded',
        p: top2.map(function (t) { return t.label; }).join(' and ') + ' produced ' + s2 + ' of ' + A.nLeads + ' opportunities. Narrow the target list to the same functions inside those sectors instead of widening the net.'
      });
    }
    if (D.bestFormat) {
      out.push({
        idx: 'Also', h: 'Rebuild the calendar around what works',
        p: 'More ' + D.bestFormat.toLowerCase() + (has(D.formatLift) ? ' — ' + r1(D.formatLift) + '% more engaging than anything else published' : '')
          + (D.bestWindow ? ', published in the ' + D.bestWindow + ' window' : '') + ', and fewer of the formats that underperformed.'
      });
    } else if (A.dated.length) {
      out.push({ idx: 'Also', h: 'Keep the publishing cadence', p: 'Content and outreach moved together this month. Holding the posting rhythm keeps the outbound warm before the first message lands.' });
    }
    return out.slice(0, 3);
  }

  function thesis(A) {
    var D = A.d;
    if (has(A.efficiencyGap) && A.efficiencyGap > 10) {
      return {
        lead: 'Outreach volume barely moved. Output nearly doubled. ' + (D.periodLabel ? D.periodLabel.split(' ')[0] : 'The month') + ' was <em>an efficiency month</em>, not a volume month.',
        aside: 'Connections sent rose ' + r1(D.dSent) + '% while qualified opportunities rose ' + r1(D.dOpportunities) + '% — the same machine, better targeted, converting harder at every step.'
      };
    }
    if (has(D.dOpportunities) && D.dOpportunities > 0) {
      return {
        lead: 'Opportunities were up ' + r1(D.dOpportunities) + '% on the month, and <em>the pipeline broadened</em> with them.',
        aside: fmt(A.opps) + ' opportunities across ' + A.companies + ' companies' + (A.industry.length ? ', led by ' + A.industry[0].label.toLowerCase() : '') + '.'
      };
    }
    return {
      lead: fmt(A.opps) + ' qualified opportunities, ' + (A.companies ? 'across <em>' + A.companies + ' companies</em>' : 'this period') + '.',
      aside: (has(A.acceptRate) ? Math.round(A.acceptRate) + '% of connection requests were accepted' : 'Outreach and content ran together this month')
        + (has(A.convRate) ? ', and ' + Math.round(A.convRate) + '% of those became conversations.' : '.')
    };
  }

  /* ============================================================
     6. Charts (inline SVG, drawn to one scale)
     ============================================================ */
  var C = { accent: '#cc3333', mid: '#b02c2c', deep: '#7d1f1f', cool: '#2f6180', neutral: '#c6bcb8', ink3: '#8a817e', rule: '#ded6d3', surf2: '#ece6e4' };

  function svgCumulative(A) {
    if (A.dated.length < 3 || !A.d.periodStart) return '';
    var W = 520, H = 190, P = { t: 14, r: 16, b: 30, l: 34 };
    var s = new Date(A.d.periodStart + 'T00:00:00Z'), e = new Date(A.d.periodEnd + 'T00:00:00Z');
    var span = Math.max(1, (e - s) / 86400000);
    var maxY = A.dated.length;
    var X = function (t) { return P.l + ((t - s) / 86400000 / span) * (W - P.l - P.r); };
    var Y = function (v) { return H - P.b - (v / maxY) * (H - P.t - P.b); };
    var pts = [{ x: X(s), y: Y(0) }];
    A.dated.forEach(function (o, i) { pts.push({ x: X(o.t), y: Y(i) }); pts.push({ x: X(o.t), y: Y(i + 1) }); });
    pts.push({ x: X(e), y: Y(maxY) });
    var dPath = pts.map(function (p, i) { return (i ? 'L' : 'M') + r1(p.x) + ' ' + r1(p.y); }).join(' ');
    var area = dPath + ' L' + r1(X(e)) + ' ' + r1(Y(0)) + ' L' + r1(X(s)) + ' ' + r1(Y(0)) + ' Z';
    var ticks = '', step = Math.max(1, Math.ceil(maxY / 4));
    for (var v = 0; v <= maxY; v += step) {
      ticks += '<line x1="' + P.l + '" y1="' + r1(Y(v)) + '" x2="' + (W - P.r) + '" y2="' + r1(Y(v)) + '" stroke="' + C.rule + '" stroke-width="1"/>'
        + '<text x="' + (P.l - 7) + '" y="' + r1(Y(v) + 3.5) + '" text-anchor="end" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">' + v + '</text>';
    }
    var xl = '';
    [0, 0.5, 1].forEach(function (f) {
      var t = new Date(s.getTime() + f * span * 86400000);
      xl += '<text x="' + r1(X(t)) + '" y="' + (H - 9) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">' + dm(t) + '</text>';
    });
    var last = A.dated[A.dated.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative opportunities through the period, ending at ' + maxY + '">'
      + ticks
      + '<path d="' + area + '" fill="' + C.accent + '" fill-opacity="0.10"/>'
      + '<path d="' + dPath + '" fill="none" stroke="' + C.accent + '" stroke-width="2" stroke-linejoin="round"/>'
      + '<circle cx="' + r1(X(last.t)) + '" cy="' + r1(Y(maxY)) + '" r="4" fill="' + C.accent + '" stroke="#fff" stroke-width="2"/>'
      + '<text x="' + r1(X(last.t) - 8) + '" y="' + r1(Y(maxY) - 8) + '" text-anchor="end" font-size="11" font-weight="600" font-family="Archivo, sans-serif" fill="' + C.accent + '">' + maxY + '</text>'
      + xl + '</svg>';
  }

  function svgMoM(A) {
    if (A.mom.length < 3) return '';
    var rows = A.mom, W = 520, rowH = 30, P = { t: 18, l: 96, r: 46 };
    var H = P.t + rows.length * rowH + 8;
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.now, r.prev); }));
    var bw = W - P.l - P.r;
    var body = '';
    rows.forEach(function (r, i) {
      var y = P.t + i * rowH;
      var wPrev = Math.max(2, (r.prev / max) * bw), wNow = Math.max(2, (r.now / max) * bw);
      body += '<text x="' + (P.l - 10) + '" y="' + (y + 13) + '" text-anchor="end" font-size="11" font-family="IBM Plex Sans, sans-serif" fill="#55504e">' + esc(r.label) + '</text>'
        + '<rect x="' + P.l + '" y="' + y + '" width="' + r1(wPrev) + '" height="8" rx="2" fill="' + C.neutral + '"/>'
        + '<rect x="' + P.l + '" y="' + (y + 11) + '" width="' + r1(wNow) + '" height="8" rx="2" fill="' + C.accent + '"/>'
        + '<text x="' + (W - P.r + 6) + '" y="' + (y + 15) + '" font-size="10.5" font-weight="600" font-family="IBM Plex Mono, monospace" fill="' + (r.d >= 0 ? C.accent : '#8a817e') + '">' + (r.d > 0 ? '+' : '') + r1(r.d) + '%</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Previous month compared with this month across six activity measures">'
      + '<rect x="' + P.l + '" y="2" width="9" height="9" rx="2" fill="' + C.neutral + '"/><text x="' + (P.l + 14) + '" y="10" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">PREVIOUS</text>'
      + '<rect x="' + (P.l + 78) + '" y="2" width="9" height="9" rx="2" fill="' + C.accent + '"/><text x="' + (P.l + 92) + '" y="10" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">THIS PERIOD</text>'
      + body + '</svg>';
  }

  function svgWeeks(A) {
    if (A.weekly.length < 2) return '';
    var w = A.weekly, W = 520, H = 150, P = { t: 12, r: 10, b: 34, l: 26 };
    var max = Math.max(1, Math.max.apply(null, w.map(function (x) { return x.n; })));
    var bw = (W - P.l - P.r) / w.length;
    var body = '';
    w.forEach(function (b, i) {
      var h = (b.n / max) * (H - P.t - P.b);
      var x = P.l + i * bw + bw * 0.16, ww = bw * 0.68, y = H - P.b - h;
      body += '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(ww) + '" height="' + r1(Math.max(h, b.n ? 3 : 0)) + '" rx="3" fill="' + C.accent + '"/>'
        + (b.n ? '<text x="' + r1(x + ww / 2) + '" y="' + r1(y - 5) + '" text-anchor="middle" font-size="11" font-weight="600" font-family="IBM Plex Mono, monospace" fill="#2a2a2a">' + b.n + '</text>' : '')
        + '<text x="' + r1(x + ww / 2) + '" y="' + (H - 13) + '" text-anchor="middle" font-size="9" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">' + dm(b.from) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Opportunities logged per week">'
      + '<line x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '" stroke="' + C.rule + '"/>' + body + '</svg>';
  }

  function svgMeter(A) {
    if (!has(A.engRate)) return '';
    var W = 520, H = 86, P = { l: 8, r: 8 }, span = Math.max(10, Math.ceil(A.engRate * 1.35));
    var bw = W - P.l - P.r;
    var X = function (v) { return P.l + Math.min(v, span) / span * bw; };
    var band = [X(2), X(5)];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Engagement rate of ' + r1(A.engRate) + '% against the typical 2 to 5% company page band">'
      + '<rect x="' + P.l + '" y="30" width="' + bw + '" height="14" rx="7" fill="' + C.surf2 + '"/>'
      + '<rect x="' + r1(band[0]) + '" y="30" width="' + r1(band[1] - band[0]) + '" height="14" fill="' + C.cool + '" fill-opacity="0.22"/>'
      + '<text x="' + r1((band[0] + band[1]) / 2) + '" y="60" text-anchor="middle" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.cool + '">TYPICAL 2–5%</text>'
      + '<rect x="' + P.l + '" y="30" width="' + r1(X(A.engRate) - P.l) + '" height="14" rx="7" fill="' + C.accent + '"/>'
      + '<circle cx="' + r1(X(A.engRate)) + '" cy="37" r="8" fill="' + C.accent + '" stroke="#fff" stroke-width="2.5"/>'
      + '<text x="' + r1(Math.min(X(A.engRate), W - 40)) + '" y="20" text-anchor="middle" font-size="15" font-weight="700" font-family="Archivo, sans-serif" fill="' + C.accent + '">' + r1(A.engRate) + '%</text>'
      + '<text x="' + P.l + '" y="76" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">0%</text>'
      + '<text x="' + (W - P.r) + '" y="76" text-anchor="end" font-size="9.5" font-family="IBM Plex Mono, monospace" fill="' + C.ink3 + '">' + span + '%</text>'
      + '</svg>';
  }

  function bars(items, color, total) {
    if (!items || !items.length) return '';
    var max = total || Math.max.apply(null, items.map(function (i) { return i.value; }));
    return items.map(function (i) {
      return '<div class="brow"><span class="bl">' + esc(i.label) + '</span><span class="bn">' + i.value + '</span>'
        + '<div class="btrack"><div class="bfill" style="width:' + r1(pct(i.value, max)) + '%;background:' + color + '"></div></div></div>';
    }).join('');
  }

  function stack(items, colors) {
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    return '<div class="stackbar">' + items.map(function (i, n) {
      return '<div style="width:' + r1(pct(i.value, total)) + '%;background:' + colors[n % colors.length] + '">' + i.value + '</div>';
    }).join('') + '</div><div class="stacklegend">' + items.map(function (i, n) {
      return '<span><i class="sw" style="background:' + colors[n % colors.length] + '"></i>' + esc(i.label) + '</span>';
    }).join('') + '</div>';
  }

  /* ============================================================
     7. Report renderer
     ============================================================ */
  function tagClass(industry) {
    var t = (industry || '').toLowerCase();
    if (/bio|pharma|life/.test(t)) return 'background:var(--accent-soft);color:var(--accent-deep)';
    if (/chem|manufact|material/.test(t)) return 'background:var(--cool-soft);color:var(--cool)';
    return 'background:var(--surface-2);color:var(--ink-2)';
  }
  function shortSector(s) {
    var t = (s || '').toLowerCase();
    if (/biotech/.test(t)) return 'Biotech';
    if (/pharma/.test(t)) return 'Pharma';
    if (/chemical/.test(t)) return 'Chem mfg';
    if (/research serv/.test(t)) return 'Research';
    if (/manufactur/.test(t)) return 'Mfg';
    return (s || '').split(/\s+/).slice(0, 2).join(' ');
  }
  function shortDate(s) {
    var d = parseDate(s);
    return d ? d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3) : esc(s || '');
  }
  function chip(v, suffix) {
    if (!has(v)) return '<span class="chip flat">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    return '<span class="chip ' + cls + '">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(r1(v)) + (suffix || '%') + '</span>';
  }
  function mrow(k, v, c) { return '<div class="mrow"><span class="mk">' + k + '</span><span class="mv num">' + fmt(v) + '</span>' + c + '</div>'; }
  function sec(title, note, body) {
    return '<section><div class="head"><h2>' + title + '</h2><div class="line"></div>'
      + (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>' + body + '</section>';
  }

  function render(D) {
    var A = analyse(D), T = thesis(A), CC = conclusions(A), NA = nextActions(A);
    var H = [];

    H.push('<div class="rule-top"></div><div class="sheet">');

    /* masthead */
    H.push('<div class="masthead"><div>'
      + '<div class="eyebrow">Monthly LinkedIn Performance</div>'
      + '<h1>' + esc(D.client || 'Client') + '</h1>'
      + '<div class="period">' + esc(D.periodLabel || '') + (D.periodStart && D.periodEnd ? ' &nbsp;·&nbsp; ' + shortDate(D.periodStart) + ' – ' + shortDate(D.periodEnd) : '') + '</div>'
      + '</div><div class="by">'
      + (D.logo ? '<img src="' + esc(D.logo) + '" alt="">' : '')
      + '<strong>' + esc(D.preparedBy || 'Gershon Consulting') + '</strong>'
      + (D.accountManager ? 'Account Manager · ' + esc(D.accountManager) + '<br>' : '')
      + 'Outbound &amp; organic LinkedIn<br>Issued ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      + '</div></div>');

    /* thesis */
    H.push('<div class="thesis"><p>' + T.lead + '</p><div class="aside">' + esc(T.aside).replace(/&lt;em&gt;/g, '<em>') + '</div></div>');

    /* hero band */
    var cells = [];
    if (has(A.opps)) cells.push({ k: 'Qualified opportunities', v: fmt(A.opps), d: (has(D.dOpportunities) ? '<b>' + (D.dOpportunities > 0 ? '+' : '') + r1(D.dOpportunities) + '%</b> vs previous period · ' : '') + (A.companies ? A.companies + ' different companies' : '') });
    if (has(D.sent)) cells.push({ k: 'Outreach volume', v: (has(D.dSent) ? (D.dSent > 0 ? '+' : '') + r1(D.dSent) + '%' : fmt(D.sent)), d: '<b>' + fmt(D.sent) + '</b> connection requests sent' + (has(D.dSent) && Math.abs(D.dSent) < 15 ? ' — essentially flat month on month' : '') });
    if (has(A.acceptRate)) cells.push({ k: 'Acceptance rate', v: Math.round(A.acceptRate) + '%', d: (has(D.dAccepted) ? '<b>' + (D.dAccepted > 0 ? '+' : '') + r1(D.dAccepted) + '%</b> acceptances vs previous period' : '<b>' + fmt(D.accepted) + '</b> accepted') });
    while (cells.length < 3 && has(D.impressions)) { cells.push({ k: 'Content impressions', v: fmt(D.impressions), d: (has(D.posts) ? '<b>' + D.posts + '</b> posts published' : '') }); break; }
    if (cells.length) {
      H.push('<div class="band">' + cells.slice(0, 3).map(function (c) {
        return '<div class="cell"><div class="k">' + c.k + '</div><div class="v num">' + c.v + '</div><div class="d">' + c.d + '</div></div>';
      }).join('') + '</div>');
    }

    /* efficiency ratios */
    var R = [];
    if (has(A.sentPerOpp)) R.push(['<span class="r-v num">' + Math.round(A.sentPerOpp) + '</span>', 'Connection requests per opportunity generated']);
    if (has(A.convRate)) R.push(['<span class="r-v num">' + Math.round(A.convRate) + '<span>%</span></span>', 'Of accepted connections turned into a live conversation']);
    if (has(A.paceDays)) R.push(['<span class="r-v num">' + r1(A.paceDays) + ' <span>days</span></span>', 'Average gap between new opportunities, in working days']);
    if (has(D.reach)) R.push(['<span class="r-v num">' + fmt(D.reach) + '</span>', 'People reached organically' + (has(A.reachMult) ? ' — ' + r1(A.reachMult) + '× the follower base' : '')]);
    if (has(A.imprPerPost) && R.length < 4) R.push(['<span class="r-v num">' + fmt(Math.round(A.imprPerPost)) + '</span>', 'Average impressions per post published']);
    if (R.length >= 3) {
      H.push(sec('What that efficiency looks like', 'Derived from this period', '<div class="ratios">' + R.slice(0, 4).map(function (r) {
        return '<div class="rt">' + r[0] + '<div class="r-k">' + r[1] + '</div></div>';
      }).join('') + '</div>'));
    }

    /* conversion cascade */
    if (has(D.sent) && has(A.opps)) {
      var steps = [
        { l: 'Connections sent', v: D.sent, p: '100%', c: 'var(--f1)' },
        { l: 'Accepted', v: D.accepted, p: has(A.acceptRate) ? Math.round(A.acceptRate) + '% of sent' : '', c: 'var(--f2)' },
        { l: 'Conversations', v: D.messages, p: has(A.convRate) ? Math.round(A.convRate) + '% of accepted' : '', c: 'var(--f3)' },
        { l: 'Opportunities', v: A.opps, p: has(A.oppOfConv) ? r1(A.oppOfConv) + '% of conversations' : '', c: 'var(--f3)' }
      ].filter(function (s) { return has(s.v); });
      var fun = '<div class="funnel">' + steps.map(function (s) {
        return '<div class="f-label">' + s.l + '</div><div class="f-bar-wrap">'
          + '<div class="f-bar" style="width:' + r1(pct(s.v, D.sent)) + '%;background:' + s.c + '"></div>'
          + '<div class="f-val">' + fmt(s.v) + '</div><div class="f-pct">' + s.p + '</div></div>';
      }).join('') + '</div>';
      var note = has(A.convRate) && A.convRate >= 75
        ? 'The costly step in outbound is normally getting a reply. Here it isn\'t: <b>' + Math.round(A.convRate) + '% of everyone who accepted went on to have a conversation</b>. The campaign\'s leverage now sits in the last step — turning conversations into opportunities.'
        : 'Each step compounds: a point gained on acceptance carries all the way through to opportunities, which is where the next period\'s targeting work is aimed.';
      fun += '<div class="callout">' + note + '</div>';
      H.push(sec('Conversion cascade', 'Bars to scale · step yield at right', fun));
    }

    /* momentum: cumulative + month on month */
    var momA = svgCumulative(A), momB = svgMoM(A);
    if (momA || momB) {
      H.push(sec('Momentum', 'Pace within the period, and against the one before', '<div class="two">'
        + (momA ? '<figure><h3 style="font-size:12px;font-weight:600;margin-bottom:10px">Opportunities accumulating through the period</h3>' + momA
          + '<figcaption>Each step is a logged opportunity. A straight climb means a repeatable process rather than one good week.</figcaption></figure>' : '')
        + (momB ? '<figure><h3 style="font-size:12px;font-weight:600;margin-bottom:10px">This period against the last</h3>' + momB
          + '<figcaption>Previous-period figures are reconstructed from the percentage changes reported in the campaign export.</figcaption></figure>' : '')
        + '</div>'));
    }

    /* both channels */
    var outRows = '', orgRows = '';
    if (has(D.sent)) outRows += mrow('Connections sent', D.sent, chip(D.dSent));
    if (has(D.accepted)) outRows += mrow('Acceptances', D.accepted, chip(D.dAccepted));
    if (has(D.messages)) outRows += mrow('Conversations', D.messages, chip(D.dMessages));
    if (has(D.followups)) outRows += mrow('Follow-ups', D.followups, chip(D.dFollowups));
    if (has(D.inmails)) outRows += mrow('InMails', D.inmails, chip(D.dInmails));
    if (has(A.opps)) outRows += mrow('Opportunities', A.opps, chip(D.dOpportunities));
    if (has(D.posts)) orgRows += mrow('Posts published', D.posts, '<span class="chip flat">period</span>');
    if (has(D.impressions)) orgRows += mrow('Impressions', D.impressions, has(A.imprPerPost) ? '<span class="chip flat">' + Math.round(A.imprPerPost) + '/post</span>' : '<span class="chip flat">—</span>');
    if (has(D.reach)) orgRows += mrow('People reached', D.reach, '<span class="chip flat">unique</span>');
    if (has(D.engagements)) orgRows += mrow('Engagements', D.engagements, has(A.engRate) ? '<span class="chip up">' + r1(A.engRate) + '% rate</span>' : '<span class="chip flat">—</span>');
    if (has(D.reactions)) orgRows += mrow('Reactions', D.reactions, has(D.comments) ? '<span class="chip flat">+' + D.comments + ' comments</span>' : '<span class="chip flat">—</span>');
    if (has(D.followers)) orgRows += mrow('Followers', D.followers, has(D.followersGained) ? '<span class="chip up">+' + D.followersGained + '</span>' : '<span class="chip flat">—</span>');
    if (outRows || orgRows) {
      H.push(sec('Both channels, side by side', 'Change vs the previous period', '<div class="split">'
        + (outRows ? '<div class="chan"><h3>Outbound — Sales Navigator</h3><div class="sub">Direct approaches to named decision-makers</div>' + outRows + '</div>' : '')
        + (orgRows ? '<div class="chan organic"><h3>Organic — Company page</h3><div class="sub">Content published to the audience</div>' + orgRows + '</div>' : '')
        + '</div>'));
    }

    /* where the opportunities came from */
    var minis = [];
    if (A.industry.length) minis.push({ h: 'Industry', c: 'Which sectors actually converted.', b: bars(A.industry.slice(0, 5), C.accent) });
    if (A.leadType.length) minis.push({ h: 'Type of lead', c: 'What each contact asked for next.', b: bars(A.leadType, C.cool) });
    if (A.companySize.length) minis.push({ h: 'Company size', c: 'Of opportunities where size was recorded.', b: bars(A.companySize, C.neutral) });
    if (minis.length) {
      var mBody = '<div class="' + (minis.length === 3 ? 'tri' : 'two') + '">' + minis.map(function (m) {
        return '<div class="mini"><h3>' + m.h + '</h3><div class="cap">' + m.c + '</div>' + m.b + '</div>';
      }).join('') + '</div>';
      if (A.seniorityMix.length > 1) {
        mBody += '<div style="margin-top:26px"><div class="eyebrow" style="margin-bottom:10px">Seniority of the people responding</div>'
          + stack(A.seniorityMix, [C.deep, C.mid, C.accent, C.neutral]) + '</div>';
      }
      if (A.weekly.length > 2) {
        mBody += '<div style="margin-top:26px"><div class="eyebrow" style="margin-bottom:10px">Opportunities logged per week</div>' + svgWeeks(A) + '</div>';
      }
      if (A.geography.length) {
        mBody += '<div style="margin-top:24px"><div class="eyebrow" style="margin-bottom:9px">Geography</div><div class="geo">'
          + A.geography.map(function (g) { return '<span>' + esc(g.label) + ' <b>' + g.value + '</b></span>'; }).join('') + '</div></div>';
      }
      H.push(sec('Where the ' + (A.nLeads || '') + ' came from', 'Derived from the logged opportunities', mBody));
    }

    /* the leads */
    if (A.leads.length) {
      H.push(sec('The ' + A.nLeads + ' opportunities', 'Every lead logged this period',
        '<div class="tw"><table class="leads"><colgroup>'
        + '<col style="width:16%"><col style="width:27%"><col style="width:16%">'
        + '<col style="width:11%"><col style="width:19%"><col style="width:11%"></colgroup>'
        + '<thead><tr><th>Contact</th><th>Role</th><th>Company</th><th>Sector</th><th>Location</th><th>Logged</th></tr></thead><tbody>'
        + A.dated.concat(A.leads.filter(function (l) { return !parseDate(l.date); }).map(function (l) { return { lead: l }; }))
          .map(function (o) {
            var l = o.lead;
            return '<tr><td class="nm">' + esc(l.name) + '</td><td>' + esc(l.title) + '</td><td class="co">' + esc(l.company) + '</td>'
              + '<td>' + (l.industry ? '<span class="tag" style="' + tagClass(l.industry) + '">' + esc(shortSector(l.industry)) + '</span>' : '') + '</td>'
              + '<td>' + esc(l.location) + '</td><td class="dt">' + shortDate(l.date) + '</td></tr>';
          }).join('')
        + '</tbody></table></div>'));
    }

    /* content */
    if ((D.topPosts && D.topPosts.length) || D.bestFormat || has(A.engRate)) {
      var maxImpr = Math.max.apply(null, (D.topPosts || []).map(function (p) { return p.impressions || 0 ; }).concat([1]));
      var left = (D.topPosts || []).map(function (p) {
        var m = [];
        if (has(p.impressions)) m.push('<span><b>' + fmt(p.impressions) + '</b> impressions</span>');
        if (has(p.engagements)) m.push('<span><b>' + fmt(p.engagements) + '</b> engagements</span>');
        if (has(p.likes)) m.push('<span><b>' + fmt(p.likes) + '</b> likes</span>');
        if (has(p.comments)) m.push('<span><b>' + fmt(p.comments) + '</b> comments</span>');
        return '<div class="post"><div class="ph2"><div class="pt">' + esc(p.text) + '</div><div class="pd">' + esc(p.date) + '</div></div>'
          + '<div class="ptrack"><div class="pfill" style="width:' + r1(pct(p.impressions || 0, maxImpr)) + '%;background:var(--accent)"></div></div>'
          + '<div class="pm">' + m.join('') + '</div></div>';
      }).join('');
      if (has(A.engRate)) {
        left += '<div style="margin-top:22px"><div class="eyebrow" style="margin-bottom:8px">Engagement rate against the typical company page</div>' + svgMeter(A)
          + '<figcaption>Share of impressions that produced a reaction, comment or click. Company pages commonly sit between 2% and 5%.</figcaption></div>';
      }
      var ins = [];
      if (D.bestFormat) ins.push('<b>' + esc(D.bestFormat) + '</b> outperformed every other format' + (has(D.formatLift) ? ' — ' + r1(D.formatLift) + '% more engaging' : '') + '.');
      if (D.bestWindow) ins.push('Best publishing window: <b>' + esc(D.bestWindow) + '</b>.');
      if (D.hashtags) ins.push('Strongest hashtags: <b>' + esc(D.hashtags) + '</b>.');
      if (has(A.engRate)) ins.push('Engagement rate <b>' + r1(A.engRate) + '%</b> of impressions, counting clicks.');
      if (has(A.followerGrowth)) ins.push('Follower base grew <b>' + r1(A.followerGrowth) + '%</b> in the period.');
      var right = ins.length ? '<div class="insight"><h3>Platform read-out</h3><ul>' + ins.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'
        + (D.contentCaveat ? '<div class="caveat">' + esc(D.contentCaveat) + '</div>' : '') + '</div>' : '';
      H.push(sec('Content that pulled its weight', (D.topPosts && D.topPosts.length ? 'Top ' + D.topPosts.length + (has(D.posts) ? ' of ' + D.posts : '') + ' posts · bars to scale' : ''),
        '<div style="display:grid;grid-template-columns:' + (right ? '1fr 300px' : '1fr') + ';gap:44px;align-items:start"><div>' + left + '</div>' + right + '</div>'));
    }

    /* conclusions */
    if (CC.length) {
      H.push(sec('What the numbers say', 'Read straight off the figures above',
        '<div class="concl">' + CC.map(function (c) {
          return '<div class="cc"><div class="cfig">' + esc(c.fig) + '<small>' + esc(c.sub) + '</small></div>'
            + '<div><h4>' + esc(c.h) + '</h4><p>' + esc(c.p) + '</p></div></div>';
        }).join('') + '</div>'));
    }

    /* next */
    if (NA.length) {
      H.push(sec('Next period — in priority order', 'What we\'re changing',
        '<div class="next">' + NA.map(function (n) {
          return '<div class="n"><div class="idx">' + esc(n.idx) + '</div><h3>' + esc(n.h) + '</h3><p>' + esc(n.p) + '</p></div>';
        }).join('') + '</div>'));
    }

    if (!/<section>/.test(H.join(''))) {
      H.push('<div class="callout" style="margin-top:26px">Nothing to report yet — go back and enter at least the outbound counts or the organic figures, and the sections will build themselves.</div>');
    }

    H.push('<footer><div class="src">' + (D.sources ? esc(D.sources) : 'Sources: monthly campaign export, social analytics export and written narrative for the period.')
      + '</div><div style="white-space:nowrap;text-align:right"><b style="color:var(--ink)">' + esc(D.preparedBy || 'Gershon Consulting') + '</b><br>Prepared '
      + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div></footer>');

    H.push('</div>');
    return H.join('');
  }

  /* ============================================================
     8. Review form
     ============================================================ */
  var SCHEMA = [
    { g: 'The client and the period', note: 'Appears in the masthead', f: [
      ['client', 'Client name', 'text'], ['periodLabel', 'Period label', 'text'],
      ['periodStart', 'Period starts', 'date'], ['periodEnd', 'Period ends', 'date'],
      ['accountManager', 'Account manager', 'text'], ['preparedBy', 'Prepared by', 'text'],
      ['logo', 'Client logo URL (optional)', 'text']
    ]},
    { g: 'Outbound', note: 'Counts on the left, month-on-month change on the right', f: [
      ['sent', 'Connections sent', 'n'], ['dSent', '… change %', 'n'],
      ['accepted', 'Acceptances', 'n'], ['dAccepted', '… change %', 'n'],
      ['messages', 'Conversations', 'n'], ['dMessages', '… change %', 'n'],
      ['followups', 'Follow-ups', 'n'], ['dFollowups', '… change %', 'n'],
      ['inmails', 'InMails', 'n'], ['dInmails', '… change %', 'n'],
      ['opportunities', 'Opportunities', 'n'], ['dOpportunities', '… change %', 'n']
    ]},
    { g: 'Organic content', note: 'From the social analytics export', f: [
      ['posts', 'Posts published', 'n'], ['impressions', 'Impressions', 'n'],
      ['reach', 'People reached', 'n'], ['engagements', 'Engagements', 'n'],
      ['reactions', 'Reactions', 'n'], ['comments', 'Comments', 'n'],
      ['likes', 'Likes', 'n'], ['followers', 'Followers', 'n'], ['followersGained', 'Followers gained', 'n']
    ]},
    { g: 'Content insight', note: 'Drives the read-out panel', f: [
      ['bestFormat', 'Best-performing format', 'text'], ['formatLift', 'How much more engaging (%)', 'n'],
      ['bestWindow', 'Best publishing window', 'text'], ['hashtags', 'Strongest hashtags', 'text'],
      ['contentCaveat', 'Caveat on the above', 'text']
    ]}
  ];

  function buildForm() {
    var root = $('#form'); root.innerHTML = '';
    SCHEMA.forEach(function (grp) {
      var g = document.createElement('div'); g.className = 'grp';
      g.innerHTML = '<div class="gh"><h3>' + grp.g + '</h3><div class="line"></div><div class="note">' + grp.note + '</div></div>';
      var grid = document.createElement('div'); grid.className = 'fieldgrid';
      grp.f.forEach(function (f) {
        var key = f[0], label = f[1], type = f[2];
        var v = DATA[key];
        var missing = (v == null || v === '') && !/^(logo|contentCaveat|formatLift|hashtags|bestWindow|bestFormat|preparedBy)$/.test(key);
        var d = document.createElement('div');
        d.className = 'fld' + (missing ? ' missing' : '');
        d.innerHTML = '<label for="f_' + key + '">' + label + '</label>'
          + '<input id="f_' + key + '" data-key="' + key + '" ' + (type === 'text' ? 'data-text' : '')
          + ' type="' + (type === 'date' ? 'date' : 'text') + '" value="' + esc(v == null ? '' : v) + '">';
        grid.appendChild(d);
      });
      g.appendChild(grid); root.appendChild(g);
    });

    root.appendChild(area('leads', 'The opportunities', 'One per line: <code>Name | Job title | Company | Industry | Location | YYYY-MM-DD | Type</code>. Everything else on the page — industry, geography, seniority, pace, the weekly chart — is worked out from this list.',
      (DATA.leads || []).map(function (l) {
        return [l.name || '', l.title || (l.raw || ''), l.company || '', l.industry || '', l.location || '', l.date || '', l.type || ''].join(' | ');
      }).join('\n'), 190));

    root.appendChild(area('topPosts', 'Top posts', 'One per line: <code>Date | Post text | Impressions | Engagements | Likes | Comments</code>',
      (DATA.topPosts || []).map(function (p) {
        return [p.date || '', p.text || '', p.impressions || '', p.engagements || '', p.likes || '', p.comments || ''].join(' | ');
      }).join('\n'), 110));

    root.appendChild(area('companySize', 'Company size breakdown', 'One per line: <code>Label | Count</code>',
      (DATA.companySize || []).map(function (c) { return c.label + ' | ' + c.value; }).join('\n'), 90));

    root.appendChild(area('leadTypes', 'Type of lead', 'One per line: <code>Label | Count</code> — what each contact asked for next.',
      (DATA.leadTypes || []).map(function (c) { return c.label + ' | ' + c.value; }).join('\n'), 90));

    root.appendChild(area('sources', 'Sources note', 'Printed in the footer of the one-pager.', DATA.sources || '', 80));
  }

  function area(key, title, hint, value, h) {
    var g = document.createElement('div'); g.className = 'grp';
    g.innerHTML = '<div class="gh"><h3>' + title + '</h3><div class="line"></div></div>'
      + '<div class="fld"><div class="hint" style="margin:0 0 7px">' + hint + '</div>'
      + '<textarea data-area="' + key + '" style="min-height:' + h + 'px">' + esc(value) + '</textarea></div>';
    return g;
  }

  function readForm() {
    Array.prototype.forEach.call(document.querySelectorAll('#form input[data-key]'), function (el) {
      var k = el.dataset.key, raw = el.value.trim();
      var numeric = !el.hasAttribute('data-text') && el.type !== 'date';
      DATA[k] = raw === '' ? (numeric ? null : '') : (numeric ? num(raw) : raw);
    });
    var get = function (k) { var el = document.querySelector('[data-area="' + k + '"]'); return el ? el.value : ''; };
    DATA.leads = get('leads').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var c = l.split('|').map(function (x) { return x.trim(); });
      return { name: c[0] || '', title: c[1] || '', company: c[2] || '', industry: c[3] || '', location: c[4] || '', date: c[5] || '', type: c[6] || '' };
    });
    DATA.topPosts = get('topPosts').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var c = l.split('|').map(function (x) { return x.trim(); });
      return { date: c[0] || '', text: c[1] || '', impressions: num(c[2]), engagements: num(c[3]), likes: num(c[4]), comments: num(c[5]) };
    });
    DATA.companySize = get('companySize').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var c = l.split('|').map(function (x) { return x.trim(); });
      return { label: c[0] || '', value: num(c[1]) || 0 };
    }).filter(function (c) { return c.label && c.value; });
    DATA.leadTypes = get('leadTypes').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var c = l.split('|').map(function (x) { return x.trim(); });
      return { label: c[0] || '', value: num(c[1]) || 0 };
    }).filter(function (c) { return c.label && c.value; });
    DATA.sources = get('sources');
  }

  /* ============================================================
     9. Wiring
     ============================================================ */
  function step(n) {
    $('#view-upload').hidden = n !== 1;
    $('#view-review').hidden = n !== 2;
    $('#view-report').hidden = n !== 3;
    Array.prototype.forEach.call(document.querySelectorAll('#steps li'), function (li) {
      if (+li.dataset.step === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  function paintFiles() {
    var box = $('#filelist');
    box.hidden = !FILES.length;
    box.innerHTML = FILES.map(function (f) {
      var b = f.state === 'done'
        ? '<span class="badge ok">' + (f.kind === 'campaign' ? 'campaign' : f.kind === 'social' ? 'social' : f.kind === 'narrative' ? 'narrative' : 'read') + '</span>'
        : f.state === 'error' ? '<span class="badge err">could not read</span>'
          : '<span class="badge busy">reading…</span>';
      return '<div class="fileitem"><span class="fn">' + esc(f.name) + '</span>' + b + '</div>';
    }).join('');
    $('#toReview').disabled = !FILES.some(function (f) { return f.state === 'done'; });
  }

  function ingest(fileList) {
    var arr = Array.prototype.slice.call(fileList).filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    if (!arr.length) { toast('PDFs only, please.'); return; }
    arr.forEach(function (f) {
      var rec = { name: f.name, state: 'busy', kind: '' };
      FILES.push(rec); paintFiles();
      readPdf(f).then(function (res) {
        var text = res.text;
        rec.kind = classify(text); rec.state = 'done';
        if (rec.kind === 'campaign') parseCampaign(text, DATA, res.pages);
        else if (rec.kind === 'social') parseSocial(text, DATA);
        else if (rec.kind === 'narrative') parseNarrative(text, DATA);
        else { parseCampaign(text, DATA, res.pages); parseSocial(text, DATA); }
        paintFiles();
      }).catch(function (e) {
        console.error(e); rec.state = 'error'; paintFiles();
      });
    });
  }

  function go() {
    var drop = $('#drop'), picker = $('#picker');
    drop.addEventListener('click', function () { picker.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
    picker.addEventListener('change', function () { ingest(picker.files); picker.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) ingest(e.dataTransfer.files); });

    $('#toReview').addEventListener('click', function () { buildForm(); step(2); });
    $('#skipToForm').addEventListener('click', function () { DATA = blank(); buildForm(); step(2); });
    $('#loadSample').addEventListener('click', function () {
      DATA = JSON.parse(JSON.stringify(SAMPLE));
      FILES = [{ name: 'Enzymicals AG — worked example', state: 'done', kind: 'campaign' }];
      paintFiles(); buildForm(); step(2);
      toast('Example loaded — every figure is editable.');
    });
    $('#backToUpload').addEventListener('click', function () { readForm(); step(1); });
    $('#backToReview').addEventListener('click', function () { buildForm(); step(2); });
    $('#toReport').addEventListener('click', function () {
      readForm();
      $('#report').innerHTML = render(DATA);
      $('#rtTitle').textContent = (DATA.client || 'One-pager') + (DATA.periodLabel ? ' · ' + DATA.periodLabel : '') + ' ready';
      document.title = (DATA.client || 'One-pager') + ' — ' + (DATA.periodLabel || 'report');
      step(3);
    });
    $('#doPrint').addEventListener('click', function () { window.print(); });
    $('#exportData').addEventListener('click', function () {
      readForm();
      download((DATA.client || 'report').replace(/\W+/g, '-').toLowerCase() + '-figures.json',
        JSON.stringify(DATA, null, 2), 'application/json');
    });
    $('#doDownload').addEventListener('click', function () {
      var css = Array.prototype.map.call(document.querySelectorAll('style'), function (s) { return s.textContent; }).join('\n');
      var name = (DATA.client || 'report').replace(/\W+/g, '_') + '_' + (DATA.periodLabel || '').replace(/\W+/g, '_') + '_onepager.html';
      var html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>' + esc(DATA.client || 'One-pager') + ' — ' + esc(DATA.periodLabel || '') + '</title>'
        + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">'
        + '<style>' + css + '\nbody{background:#fff}</style></head><body><div class="report">'
        + $('#report').innerHTML + '</div></body></html>';
      download(name.replace(/_+/g, '_'), html, 'text/html');
    });
  }

  function download(name, content, type) {
    var b = new Blob([content], { type: type + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Saved ' + name);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();

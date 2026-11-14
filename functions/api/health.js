// functions/api/health.js
// GET /api/health — public liveness check (Cloudflare Pages Function).
//
// Without this file /api/health fell through to the static page and answered
// with HTML. Static site, no database: ok:true means "the Pages deployment is
// serving". No auth, no data.

const VERSION = '1.0.1';

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    app: 'report',
    version: VERSION,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

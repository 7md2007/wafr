// Wafr inbox — a tiny Cloudflare Worker (free plan).
// Apple Pay (Shortcuts) POSTs payments here; the Wafr Home Screen app collects them when it opens.
// Needs one KV namespace bound with the variable name INBOX. Items expire after 30 days.
// Endpoints (k = the 32-character key Wafr creates):
//   POST /add?k=KEY   body JSON {amount, merchant} or {text}   → store one payment
//   GET  /list?k=KEY                                           → {items:[...]}
//   POST /ack?k=KEY   body {ids:[...]}                         → delete collected items
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const str = (v, n) => String(v ?? '').slice(0, n);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(req.url);
    if (u.pathname === '/') return new Response('Wafr inbox is running.', { headers: CORS });
    if (!env.INBOX) return json({ error: 'KV binding INBOX is missing' }, 500);
    const k = u.searchParams.get('k') || '';
    if (!/^[a-f0-9]{32}$/.test(k)) return json({ error: 'bad key' }, 403);

    if (u.pathname === '/add' && req.method === 'POST') {
      const t = await req.text();
      if (t.length > 4000) return json({ error: 'too big' }, 413);
      let b;
      try { b = JSON.parse(t); } catch { b = { text: t }; }
      if (!b || typeof b !== 'object') b = { text: t };
      const id = Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
      const item = { id, at: new Date().toISOString(), amount: str(b.amount, 60), merchant: str(b.merchant, 80), text: str(b.text, 600) };
      await env.INBOX.put(k + ':' + id, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true });
    }
    if (u.pathname === '/list' && req.method === 'GET') {
      const l = await env.INBOX.list({ prefix: k + ':', limit: 100 });
      const items = (await Promise.all(l.keys.map(x => env.INBOX.get(x.name, 'json')))).filter(Boolean);
      return json({ items });
    }
    if (u.pathname === '/ack' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter(x => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, 100);
      await Promise.all(ids.map(id => env.INBOX.delete(k + ':' + id)));
      return json({ ok: true, deleted: ids.length });
    }
    return json({ error: 'not found' }, 404);
  },
};

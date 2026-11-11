// Baloot card reader — server side. The browser sends photos here; this Worker adds the Anthropic key
// (a Worker secret, never in the browser or the repo) and returns the model's JSON answer.
// Deploy: see baloot/README.md → "AI server".
import Anthropic from '@anthropic-ai/sdk';

const MAX_IMAGES = 8;                 // the app never sends more per call
const MAX_BYTES = 14 * 1024 * 1024;   // total base64 payload
const MAX_PROMPT = 12000;             // the app's prompts are ~2–4k characters
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return { ok, headers: ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' } : { vary: 'origin' } };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function validate(body) {
  if (!body || typeof body.prompt !== 'string' || !Array.isArray(body.images)) return 'bad_request';
  if (!body.prompt || body.prompt.length > MAX_PROMPT) return 'bad_prompt';
  if (!body.images.length || body.images.length > MAX_IMAGES) return 'bad_images';
  let size = 0;
  for (const im of body.images) {
    if (!im || !TYPES.has(im.media_type) || typeof im.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(im.data.slice(0, 200))) return 'bad_images';
    size += im.data.length;
  }
  return size > MAX_BYTES ? 'too_large' : null;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const c = cors(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/read') return json({ error: 'not_found' }, 404, c.headers);
    if (!c.ok) return json({ error: 'origin' }, 403, c.headers);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503, c.headers);
    // per-visitor limit (Cloudflare Rate Limiting binding "RL" in wrangler.jsonc); skipped if the binding is missing
    if (env.RL) {
      const ip = req.headers.get('cf-connecting-ip') || 'x';
      const { success } = await env.RL.limit({ key: ip });
      if (!success) return json({ error: 'rate_limited' }, 429, c.headers);
    }
    if (Number(req.headers.get('content-length') || 0) > MAX_BYTES + 64 * 1024) return json({ error: 'too_large' }, 413, c.headers);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'bad_request' }, 400, c.headers); }
    const bad = validate(body);
    if (bad) return json({ error: bad }, 400, c.headers);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, authToken: null, baseURL: 'https://api.anthropic.com' }) // only the Worker secret, never an ambient token;
    const content = body.images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }));
    content.push({ type: 'text', text: body.prompt });
    try {
      const msg = await client.beta.messages.create({
        model: env.MODEL || 'claude-opus-5-5',
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',                                   // a declined request is retried server-side on the recommended model
        output_config: { effort: env.EFFORT || 'low' },         // card reading is short; low effort = faster answers
        messages: [{ role: 'user', content }],
      });
      if (msg.stop_reason === 'refusal') return json({ error: 'refused' }, 422, c.headers);
      const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return json({ text, model: msg.model }, 200, c.headers);
    } catch (e) {
      const status = e && e.status;
      if (status === 429 || status === 529) return json({ error: 'rate_limited' }, 429, c.headers);
      return json({ error: 'upstream' }, 502, c.headers);
    }
  },
};

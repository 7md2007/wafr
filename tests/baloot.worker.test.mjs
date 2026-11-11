// AI server (baloot/ai-worker/worker.js) without a real key: the Anthropic API is faked with a stubbed fetch.
// Run: (cd baloot/ai-worker && npm ci) && node tests/baloot.worker.test.mjs
import worker, { validate } from '../baloot/ai-worker/worker.js';
let pass = 0, fail = 0;
const ok = (name, c, info) => { if (c) pass++; else { fail++; console.log('FAIL', name, info ?? ''); } console.log((c ? '  ✓ ' : '  ✗ ') + name); };
const ORIGIN = 'https://7md2007.github.io';
const env = { ANTHROPIC_API_KEY: 'sk-ant-test-not-real', ALLOWED_ORIGINS: ORIGIN, MODEL: 'claude-opus-5-5', EFFORT: 'low' };
const img = { media_type: 'image/jpeg', data: Buffer.from('fake-jpeg-bytes').toString('base64') };
const req = (body, origin = ORIGIN, method = 'POST', path = '/read') => new Request('https://baloot-ai.example.workers.dev' + path,
  { method, headers: { 'content-type': 'application/json', origin }, body: method === 'POST' ? JSON.stringify(body) : undefined });
let sent = null, reply = null;
globalThis.fetch = async (url, init) => {
  sent = { url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) };
  return new Response(JSON.stringify(reply), { status: reply.__status || 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
};
const okReply = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"cards":[{"rank":"A","suit":"S","conf":0.97}]}' }], usage: { input_tokens: 10, output_tokens: 5 } };

console.log('request checks');
ok('no prompt → 400', validate({ images: [img] }) === 'bad_request');
ok('no images → 400', validate({ prompt: 'x', images: [] }) === 'bad_images');
ok('9 images → refused (max 8)', validate({ prompt: 'x', images: Array(9).fill(img) }) === 'bad_images');
ok('non-image type → refused', validate({ prompt: 'x', images: [{ media_type: 'text/html', data: 'AAAA' }] }) === 'bad_images');
ok('huge prompt → refused', validate({ prompt: 'x'.repeat(20000), images: [img] }) === 'bad_prompt');
ok('valid request passes', validate({ prompt: 'read the cards', images: [img] }) === null);

console.log('server');
reply = okReply;
let r = await worker.fetch(req({ prompt: 'read', images: [img] }, 'https://evil.example'), env);
ok('other websites are refused (403)', r.status === 403 && !r.headers.get('access-control-allow-origin'));
r = await worker.fetch(req(null, ORIGIN, 'OPTIONS'), env);
ok('CORS preflight from the app is allowed', r.status === 204 && r.headers.get('access-control-allow-origin') === ORIGIN);
r = await worker.fetch(req(null, ORIGIN, 'GET'), env);
ok('GET → 404', r.status === 404);
r = await worker.fetch(req({ prompt: 'read', images: [img] }), { ...env, ANTHROPIC_API_KEY: '' });
ok('no key configured → 503, no call made', r.status === 503);
sent = null;
r = await worker.fetch(req({ prompt: 'read the cards', images: [img] }), env);
const out = await r.json();
ok('valid photo → 200 with the model text', r.status === 200 && out.text.includes('"rank":"A"'), out);
ok('key is sent only to api.anthropic.com, in the server request', sent && sent.url.startsWith('https://api.anthropic.com/') && (sent.headers['x-api-key'] === env.ANTHROPIC_API_KEY || sent.headers.authorization === 'Bearer ' + env.ANTHROPIC_API_KEY));
ok('key never appears in the reply to the browser', !JSON.stringify(out).includes('sk-ant'));
ok('model, effort, fallbacks and image are passed', sent.body.model === 'claude-opus-5-5' && sent.body.output_config.effort === 'low' && sent.body.fallbacks === 'default'
  && String(sent.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') && sent.body.messages[0].content[0].type === 'image', sent && sent.body);
reply = { ...okReply, stop_reason: 'refusal', content: [] };
r = await worker.fetch(req({ prompt: 'read', images: [img] }), env);
ok('refusal → 422 (app shows "could not read")', r.status === 422);
reply = { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' }, __status: 429 };
r = await worker.fetch(req({ prompt: 'read', images: [img] }), { ...env });
ok('Anthropic busy → 429 to the app', r.status === 429);
let calls = 0;
r = await worker.fetch(req({ prompt: 'read', images: [img] }), { ...env, RL: { limit: async () => ({ success: (++calls) < 1 }) } });
ok('per-visitor rate limit → 429', r.status === 429);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

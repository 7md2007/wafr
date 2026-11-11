// REAL accuracy test of the card reader with a real AI (costs API credits). Not part of CI.
//   BALOOT_AI_URL=https://baloot-ai.<you>.workers.dev/read BALOOT_ORIGIN=https://<your site> node tests/baloot.ai-eval.js
//   ANTHROPIC_API_KEY=sk-ant-…  node tests/baloot.ai-eval.js            (direct; key stays in this process, never in the page)
//   node tests/baloot.ai-eval.js --stub                                  (no AI: checks the runner itself)
// Options: --runs 2 (read every image twice → stability), --only clear|lowlight|overlap|far|real, --limit N
// Evaluation set = NEW scenes (seeds 101+, never used while building the app) + your own photos in tests/vision-data/
// (each photo `x.png` with `x.json` = {"cards":["AS","10H",…]}; that folder is git-ignored — private).
// Output: summary on screen + tests/ai-eval-out/<time>/report.json, and every failed image with its reading (git-ignored).
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const STUB = !!arg('stub', false), RUNS = +arg('runs', 1), ONLY = arg('only', ''), LIMIT = +arg('limit', 0);
const AI_URL = process.env.BALOOT_AI_URL || '', KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.BALOOT_MODEL || 'claude-opus-5-5';
if (!STUB && !AI_URL && !KEY) { console.log('No AI configured. Set BALOOT_AI_URL (your AI server) or ANTHROPIC_API_KEY, or use --stub.'); process.exit(2); }

// held-out scenes: different seeds and mixes from the 21 development scenes in baloot/synth.js
const EVAL = [];
const add = (tag, name, s) => EVAL.push({ tag, name, s });
for (let i = 0; i < 6; i++) add('clear', `واضحة ${i + 1}`, { seed: 101 + i, n: 4 + (i * 3) % 9, scale: 0.15 + (i % 3) * 0.03, rot: 0.3 + i * 0.2 });
for (let i = 0; i < 4; i++) add('overlap', `متداخلة ${i + 1}`, { seed: 111 + i, n: 8 + i * 2, layout: i % 2 ? 'pile' : 'fan', scale: 0.18 + (i % 2) * 0.04, rot: 0.8 });
for (let i = 0; i < 3; i++) add('overlap', `مغطاة ${i + 1}`, { seed: 121 + i, n: 6 + i, cover: 1 + i, scale: 0.19, offEdge: i === 2 });
for (let i = 0; i < 3; i++) add('lowlight', `مظلمة ${i + 1}`, { seed: 131 + i, n: 8, scale: 0.17, rot: 0.5, dark: 0.55 + i * 0.08, noise: 10 + i * 5 });
for (let i = 0; i < 3; i++) add('lowlight', `صفراء ${i + 1}`, { seed: 141 + i, n: 8 + i, scale: 0.16, rot: 0.6, warm: 0.7 + i * 0.15, dark: 0.25 + i * 0.1 });
for (let i = 0; i < 2; i++) add('lowlight', `ظل وإضاءة جانبية ${i + 1}`, { seed: 151 + i, n: 10, scale: 0.15, rot: 0.6, uneven: 1, shadow: i });
add('lowlight', 'مهزوزة', { seed: 161, n: 8, scale: 0.17, rot: 0.4, blur: 3 });
for (let i = 0; i < 2; i++) add('far', `بعيدة ${i + 1}`, { seed: 171 + i, n: 10 + i * 6, scale: 0.08 + i * 0.01, rot: 0.5 });
add('angle', 'زاوية مائلة', { seed: 181, n: 8, skew: 0.6, scale: 0.16 });
for (const [i, bg] of ['felt', 'wood', 'white'].entries()) add('table', `طاولة ${bg}`, { seed: 191 + i, n: 10, bg, scale: 0.15, rot: 0.4 });
add('many', 'كل الورق 32', { seed: 199, n: 32, layout: 'grid', scale: 0.105, rot: 0.25 });
const realDir = path.join(__dirname, 'vision-data');
const REAL = fs.existsSync(realDir) ? fs.readdirSync(realDir).filter(f => /\.(png|jpe?g)$/i.test(f)).map(f => {
  const j = path.join(realDir, f.replace(/\.\w+$/, '.json'));
  return fs.existsSync(j) ? { tag: 'real', name: f, file: path.join(realDir, f), truth: JSON.parse(fs.readFileSync(j, 'utf8')).cards } : null; }).filter(Boolean) : [];
let SET = EVAL.concat(REAL).filter(x => !ONLY || x.tag === ONLY); if (LIMIT) SET = SET.slice(0, LIMIT);

async function callAI(prompt, images) {
  if (AI_URL) {
    const r = await fetch(AI_URL, { method: 'POST', headers: { 'content-type': 'application/json', origin: process.env.BALOOT_ORIGIN || '' }, body: JSON.stringify({ prompt, images }) });
    if (!r.ok) throw new Error('server ' + r.status);
    return (await r.json()).text;
  }
  const Anthropic = require(path.join(__dirname, '../baloot/ai-worker/node_modules/@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: KEY });
  const content = images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })).concat([{ type: 'text', text: prompt }]);
  const msg = await client.beta.messages.create({ model: MODEL, max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: process.env.BALOOT_EFFORT || 'low' }, messages: [{ role: 'user', content }] });
  if (msg.stop_reason === 'refusal') throw new Error('refused');
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

(async () => {
  const out = path.join(__dirname, 'ai-eval-out', new Date().toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage();
  let calls = 0;
  await p.exposeFunction('evalAI', async (prompt, images) => { calls++; return STUB ? null : callAI(prompt, images); });
  await p.goto('file://' + path.resolve(__dirname, '../baloot/index.html')); await p.waitForTimeout(500);
  console.log(`${SET.length} images (${EVAL.length} held-out scenes, ${REAL.length} of your photos) × ${RUNS} run(s) · AI: ${STUB ? 'STUB (reads the truth — checks the runner only)' : AI_URL ? 'your AI server' : MODEL + ' (direct)'}\n`);
  const rows = [];
  for (const item of SET) {
    for (let run = 0; run < RUNS; run++) {
      const src = item.file ? 'data:image/' + (/png$/i.test(item.file) ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(item.file).toString('base64') : null;
      const r = await p.evaluate(async ({ s, src, truthKeys, stub }) => {
        let truth, blob;
        if (src) { blob = await (await fetch(src)).blob(); truth = truthKeys.map(k => ({ rank: k.slice(0, -1), suit: k.slice(-1), identifiable: true, box: [0, 0, 1, 1] })); }
        else { const m = BalootSynth.makeScene(s); truth = m.truth; blob = await new Promise(res => m.canvas.toBlob(res, 'image/jpeg', 0.9)); }
        const b64 = x => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(x); });
        const ai = async (prompt, blobs) => {
          if (stub) { // the "perfect reader": answers from the truth (overview only) — proves the plumbing and the metrics, not the AI
            if (/zoomed crop/.test(prompt)) return { crops: [] }; if (/turquoise frame/.test(prompt)) return { cards: [] };
            return { cards: truth.filter(t => t.identifiable).map(t => ({ box: t.box.map(v => Math.round(v * 1000)), rank: t.rank, suit: t.suit, conf: 0.95 })) };
          }
          const images = []; for (const bl of blobs) images.push({ media_type: bl.type || 'image/jpeg', data: await b64(bl) });
          const t = await window.evalAI(prompt, images); const mm = String(t).match(/\{[\s\S]*\}/); return JSON.parse(mm ? mm[0] : t);
        };
        const t0 = performance.now();
        try {
          const res = await BalootVision.scanPhoto(blob, ai, { maxImages: 8 });
          const live = res.cards.filter(c => c.status !== 'removed');
          const keys = live.filter(c => c.rank && c.suit).map(c => c.rank + c.suit);
          const dups = keys.length - new Set(keys).size;
          const m = src ? (() => { const found = truthKeys.filter(k => keys.includes(k)).length, fp = [...new Set(keys)].filter(k => !truthKeys.includes(k)).length;
            return { identifiable: truthKeys.length, found, falseDet: fp, located: null, rankOK: null, suitOK: null, complete: found === truthKeys.length && !fp }; })() : BalootSynth.score(truth, res.cards);
          return Object.assign(m, { dups, flagged: live.filter(c => c.status !== 'ok').length, unread: live.filter(c => !c.rank || !c.suit).length, ms: Math.round(performance.now() - t0), msLocal: res.msLocal,
            read: keys, missed: truth.filter(t => t.identifiable && !keys.includes(t.rank + t.suit)).map(t => t.rank + t.suit) });
        } catch (e) { return { err: String(e && e.message || e) }; }
      }, { s: item.s, src, truthKeys: item.truth || null, stub: STUB });
      const row = Object.assign({ tag: item.tag, name: item.name, run }, r); rows.push(row);
      const line = r.err ? `ERROR ${r.err}` : `${r.found}/${r.identifiable} cards · false ${r.falseDet} · dup ${r.dups} · flagged ${r.flagged} · ${(r.ms / 1000).toFixed(1)} s${r.complete ? ' ✓' : ''}`;
      console.log(`  [${item.tag}] ${item.name}${RUNS > 1 ? ' #' + (run + 1) : ''}: ${line}`);
      if (r.err || !r.complete) { // keep the hard case for regression (git-ignored folder)
        const f = path.join(out, `${rows.length}-${item.tag}`);
        if (item.file) fs.copyFileSync(item.file, f + path.extname(item.file));
        else { const b64 = await p.evaluate(s => BalootSynth.makeScene(s).canvas.toDataURL('image/jpeg', 0.9).split(',')[1], item.s); fs.writeFileSync(f + '.jpg', Buffer.from(b64, 'base64')); }
        fs.writeFileSync(f + '.json', JSON.stringify({ item: { ...item, file: undefined }, result: r }, null, 1));
      }
    }
  }
  const sum = rs => { const ok = rs.filter(r => !r.err); const t = k => ok.reduce((a, r) => a + (r[k] || 0), 0);
    const loc = ok.filter(r => r.located != null);
    return { images: rs.length, errors: rs.length - ok.length, recall: t('found') / Math.max(1, t('identifiable')), rank: loc.reduce((a, r) => a + r.rankOK, 0) / Math.max(1, loc.reduce((a, r) => a + r.located, 0)),
      suit: loc.reduce((a, r) => a + r.suitOK, 0) / Math.max(1, loc.reduce((a, r) => a + r.located, 0)), complete: ok.filter(r => r.complete).length / Math.max(1, rs.length),
      falsePos: t('falseDet'), dups: t('dups'), flagged: t('flagged'), avgSec: t('ms') / Math.max(1, ok.length) / 1000, maxSec: Math.max(0, ...ok.map(r => r.ms)) / 1000 }; };
  const pct = x => (100 * x).toFixed(1) + '%';
  const groups = ['all', ...new Set(rows.map(r => r.tag))];
  console.log('\n group      images  recall   rank    suit    complete  false+  dups  flagged  avg s  max s');
  const report = {};
  for (const g of groups) { const s = sum(g === 'all' ? rows : rows.filter(r => r.tag === g)); report[g] = s;
    console.log(` ${g.padEnd(10)} ${String(s.images).padStart(6)}  ${pct(s.recall).padStart(6)}  ${pct(s.rank).padStart(6)}  ${pct(s.suit).padStart(6)}  ${pct(s.complete).padStart(8)}  ${String(s.falsePos).padStart(6)}  ${String(s.dups).padStart(4)}  ${String(s.flagged).padStart(7)}  ${s.avgSec.toFixed(1).padStart(5)}  ${s.maxSec.toFixed(1).padStart(5)}`); }
  if (RUNS > 1) { const by = {}; rows.filter(r => !r.err).forEach(r => (by[r.name] = by[r.name] || []).push(r.read.slice().sort().join()));
    const stable = Object.values(by).filter(v => v.every(x => x === v[0])).length; console.log(`\n stable between runs: ${stable}/${Object.keys(by).length} images`); report.stable = { stable, of: Object.keys(by).length }; }
  console.log(` AI calls: ${calls}${STUB ? ' (stub)' : ''}`);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), stub: STUB, model: AI_URL ? 'server' : MODEL, runs: RUNS, report, rows }, null, 1));
  console.log(` saved: ${path.relative(process.cwd(), out)}/report.json (+ failed images)`);
  await b.close();
})();

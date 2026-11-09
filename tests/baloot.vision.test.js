// Card-recognition pipeline tests — run: node tests/baloot.vision.test.js
// Covers the local detector, crop planning, coordinate mapping, merging and deck rules. The AI itself is NOT tested here
// (no API access in tests): where an AI answer is needed, a stub answers from the known truth so the plumbing is checked.
// Real AI accuracy is measured in the app: ⋯ → "اختبار دقة قراءة الأوراق".
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const V = require('../baloot/vision.js');
let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, i !== undefined ? JSON.stringify(i) : '') } };
const B = (x0, y0, x1, y1) => [x0, y0, x1, y1];

console.log('merge and deck rules (no AI)');
let m = V.mergeDetections(
  [{ box: B(100, 100, 200, 300), rank: 'Q', suit: 'H', conf: 0.9 }, { box: B(400, 100, 500, 300), rank: '9', suit: 'S', conf: 0.95 }],
  [{ crop: [0, 0, 0.5, 0.5], cards: [{ box: B(200, 200, 400, 600), rank: 'Q', suit: 'H', conf: 0.9 }, { box: B(600, 300, 800, 700), rank: 'A', suit: 'H', conf: 0.85 }] }]);
ok('pass A found 2, the zoomed crop found Q♥ again + A♥ → 3 unique cards', m.length === 3 && m.map(c => c.rank + c.suit).sort().join(',') === '9S,AH,QH', m);
ok('crop boxes are mapped back to photo coordinates (Q♥ crop box 100–200 × 100–300)', (() => { const q = m.find(c => c.rank === 'Q'); return Math.abs(q.box[0] - 0.1) < 0.02 && Math.abs(q.box[3] - 0.3) < 0.02; })());
ok('a card both passes read the same way is "ok" with higher confidence', m.find(c => c.rank === 'Q').status === 'ok' && m.find(c => c.rank === 'Q').conf === 1);
m = V.mergeDetections([{ box: B(100, 100, 200, 300), rank: 'Q', suit: 'H', conf: 0.8 }], [{ crop: [0, 0, 1, 1], cards: [{ box: B(105, 98, 205, 302), rank: 'Q', suit: 'D', conf: 0.8 }] }]);
ok('passes disagree (Q♥ vs Q♦) → one card, status "check", the other as an option', m.length === 1 && m[0].status === 'check' && m[0].alts.length >= 1, m);
m = V.mergeDetections([{ box: B(100, 100, 200, 300), rank: 'K', suit: 'S', conf: 0.9, alts: [{ rank: 'K', suit: 'C' }] }, { box: B(700, 600, 800, 800), rank: 'K', suit: 'S', conf: 0.6, alts: [{ rank: 'K', suit: 'C' }] }], []);
ok('same card seen in two far-apart places → impossible (one deck): weaker one flagged with its next option', m.length === 2 && m.filter(c => c.status === 'check').length === 1 && m.some(c => c.rank + c.suit === 'KC' && c.dupOf === 'KS'), m);
m = V.mergeDetections([{ box: B(100, 100, 200, 300), rank: null, suit: 'H', conf: 0.3 }], []);
ok('a card nobody could read stays as "unreadable" with its place (never dropped, never guessed)', m.length === 1 && m[0].status === 'unreadable' && m[0].suit === 'H' && m[0].box);
ok('normalises answers: "T"→10, lower case, swapped box corners, bad values', (() => { const n = V.normCard({ rank: 't', suit: 'hearts', box: [300, 400, 100, 200], conf: 7 }); return n.rank === '10' && n.suit === 'H' && n.box[0] === 0.1 && n.box[3] === 0.4 && n.conf === 0.5; })());
ok('answers without a box are ignored, not counted', V.mergeDetections([{ rank: 'A', suit: 'S', conf: 1 }], []).length === 0);
ok('low confidence alone → "check"', V.mergeDetections([{ box: B(1, 1, 100, 100), rank: '7', suit: 'D', conf: 0.55 }], [])[0].status === 'check');

(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ path: path.join(__dirname, '../baloot/vision.js') }); await p.addScriptTag({ path: path.join(__dirname, '../baloot/synth.js') });

  console.log('\nlocal detector on 16 synthetic photos');
  const syn = await p.evaluate(() => BalootSynth.SCENES.map(s => {
    const { canvas, truth } = BalootSynth.makeScene(s); const t0 = performance.now();
    const sm = BalootVision.canvasOf(canvas, 512); const d = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height);
    const det = BalootVision.findCardBlobs(d.data, sm.width, sm.height); const ms = performance.now() - t0;
    const crops = BalootVision.cropPlan(det, 8);
    const inside = (bx, t) => { const cx = (t.box[0] + t.box[2]) / 2, cy = (t.box[1] + t.box[3]) / 2; return cx >= bx[0] && cx <= bx[2] && cy >= bx[1] && cy <= bx[3]; };
    const ident = truth.filter(t => t.identifiable);
    return { name: s.name, ident: ident.length, inCrop: ident.filter(t => crops.some(c => inside(c, t))).length, reliable: det.reliable, crops: crops.length, ms: Math.round(ms) };
  }));
  syn.forEach(r => console.log(`      ${r.name}: ${r.inCrop}/${r.ident} readable cards inside a zoom crop · ${r.crops} crops · ${r.reliable ? 'regions found' : 'no regions → 2×2 tiles'} · ${r.ms} ms`));
  ok('every readable synthetic card lies inside at least one zoom crop', syn.every(r => r.inCrop === r.ident), syn.filter(r => r.inCrop !== r.ident));
  ok('white table: detector says "not reliable" and falls back to 4 tiles', syn.find(r => r.name.includes('بيضاء')).crops === 4);
  ok('local analysis is fast (< 150 ms per photo here)', syn.every(r => r.ms < 150), syn.map(r => r.ms));

  console.log('\nlocal detector on your two real photos (card centres marked by hand)');
  const REAL = { 'real1.png': [[590, 95], [590, 185], [560, 265], [700, 260], [500, 245], [415, 290], [305, 270], [130, 370], [300, 465], [560, 490]],
    'real2.png': [[318, 215], [330, 240], [305, 265], [395, 260], [272, 265], [230, 290], [175, 290], [60, 335], [160, 375], [335, 370]] };
  for (const [f, centres] of Object.entries(REAL)) {
    const file = path.join(__dirname, 'vision-data', f);
    if (!fs.existsSync(file)) { console.log('      (missing', f, ')'); continue; }
    const data = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    const r = await p.evaluate(async ([data, centres]) => {
      const img = new Image(); img.src = data; await img.decode();
      const sm = BalootVision.canvasOf(img, 512); const d = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height);
      const det = BalootVision.findCardBlobs(d.data, sm.width, sm.height); const crops = BalootVision.cropPlan(det, 8);
      const W = img.naturalWidth, H = img.naturalHeight;
      const miss = centres.filter(([x, y]) => !crops.some(c => x / W >= c[0] && x / W <= c[2] && y / H >= c[1] && y / H <= c[3]));
      return { crops: crops.length, miss: miss.length };
    }, [data, centres]);
    ok(`${f}: all 10 cards fall inside the ${r.crops} zoom crops`, r.miss === 0, r);
  }

  console.log('\nfull pipeline with a stub AI that answers from the truth (checks plumbing, not accuracy)');
  const e2e = await p.evaluate(async () => {
    const out = [];
    for (const s of BalootSynth.SCENES.filter((_, i) => [2, 8, 9, 15].includes(i))) {
      const { canvas, truth } = BalootSynth.makeScene(s);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
      let calls = 0; const seen = { a: 0, b: 0 };
      const ai = async (prompt, imgs) => {
        calls++;
        const vis = truth.filter(t => t.identifiable);
        if (/zoomed crop/.test(prompt)) { // pass B: answer per crop, boxes relative to the crop
          const crops = BalootVision.cropPlan((() => { const sm = BalootVision.canvasOf(canvas, 512); const d = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height); return BalootVision.findCardBlobs(d.data, sm.width, sm.height); })(), 8);
          return { crops: crops.map((c, i) => ({ i: i + 1, cards: vis.filter(t => { const cx = (t.box[0] + t.box[2]) / 2, cy = (t.box[1] + t.box[3]) / 2; return cx >= c[0] && cx <= c[2] && cy >= c[1] && cy <= c[3]; })
            .map(t => { seen.b++; return { box: [(t.box[0] - c[0]) / (c[2] - c[0]), (t.box[1] - c[1]) / (c[3] - c[1]), (t.box[2] - c[0]) / (c[2] - c[0]), (t.box[3] - c[1]) / (c[3] - c[1])].map(v => Math.round(Math.min(1, Math.max(0, v)) * 1000)), rank: t.rank, suit: t.suit, conf: 0.9 }; }) })) };
        }
        // pass A: pretend the overview photo misses every card that is less than 60% visible (like the far shot)
        return { cards: vis.filter(t => t.visible >= 0.6).map(t => { seen.a++; return { box: t.box.map(v => Math.round(v * 1000)), rank: t.rank, suit: t.suit, conf: 0.85 }; }) };
      };
      const r = await BalootVision.scanPhoto(blob, ai, { maxImages: 8 });
      const sc = BalootSynth.score(truth, r.cards);
      out.push({ name: s.name, ident: sc.identifiable, found: sc.found, falseDet: sc.falseDet, onlyA: seen.a, calls, ms: r.ms, dup: r.cards.length - new Set(r.cards.map(c => c.rank + c.suit)).size });
    }
    return out;
  });
  e2e.forEach(r => console.log(`      ${r.name}: ${r.found}/${r.ident} (overview alone had ${r.onlyA}) · ${r.falseDet} false · ${r.calls} AI calls · ${r.ms} ms`));
  ok('cards the overview missed are recovered from the zoom crops', e2e.every(r => r.found === r.ident) && e2e.some(r => r.onlyA < r.ident), e2e);
  ok('no card counted twice, no invented cards', e2e.every(r => r.dup === 0 && r.falseDet === 0));
  ok('two AI calls per photo (overview + crops, sent at the same time)', e2e.every(r => r.calls === 2));
  ok('no page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();

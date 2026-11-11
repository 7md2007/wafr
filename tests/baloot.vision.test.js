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
console.log('regressions: confirmation and conflicts');
let cc = [{ id: 1, rank: 'J', suit: 'C', conf: 0.95, status: 'ok', box: B(0, 0, 100, 100) }, { id: 2, rank: 'J', suit: 'C', conf: 0.95, status: 'ok', box: B(500, 0, 600, 100) }];
V.markConflicts(cc);
ok('two unconfirmed cards with one identity → both flagged', cc.every(c => c.status === 'check' && c.conflict));
cc[1].status = 'removed'; V.markConflicts(cc);
ok('the conflict goes away → the remaining card is released (back to ok)', cc[0].status === 'ok' && !cc[0].conflict);
cc = [{ id: 1, rank: 'A', suit: 'S', conf: 0.9, status: 'ok', box: B(0, 0, 100, 100), user: true }, { id: 2, rank: 'A', suit: 'S', conf: 0.9, status: 'ok', box: B(500, 0, 600, 100), alts: ['A' + 'C'] }];
V.markConflicts(cc);
ok('a card the user confirmed wins: the other is asked for its real identity (A♠ moved to suggestions), user card untouched', cc[0].status === 'ok' && cc[1].rank === null && cc[1].status === 'check' && cc[1].alts[0] === 'AS');
cc = [{ id: 1, rank: 'Q', suit: 'H', conf: 0.65, status: 'ok', box: B(0, 0, 100, 100), passes: ['A', 'B'] }];
ok('two passes agreeing at 65% is enough (fewer needless confirmations)', V.mergeDetections([{ box: B(0, 0, 100, 300), rank: 'Q', suit: 'H', conf: 0.6 }], [{ crop: [0, 0, 1, 1], cards: [{ box: B(0, 0, 100, 300), rank: 'Q', suit: 'H', conf: 0.55 }] }])[0].status === 'ok');
console.log('regressions: 14 vs 13 cards, "A♣ in another location"');
// R1: the overview and a zoom crop both read A♣ but their boxes landed apart → it is ONE card (used to become two → 14 vs 13)
m = V.mergeDetections([{ box: B(100, 100, 200, 300), rank: 'A', suit: 'C', conf: 0.9 }], [{ crop: [0, 0, 1, 1], cards: [{ box: B(420, 380, 520, 580), rank: 'A', suit: 'C', conf: 0.9 }] }]);
ok('R1 same card from two passes with drifted boxes → 1 card, no conflict', m.length === 1 && !m[0].conflict && m[0].status === 'ok', m);
// R2: one answer lists A♣ twice in two places → a real conflict: both kept, both flagged, nothing renamed or added
m = V.mergeDetections([{ box: B(100, 100, 200, 300), rank: 'A', suit: 'C', conf: 0.9, alts: [{ rank: 'A', suit: 'S' }] }, { box: B(700, 600, 800, 800), rank: 'A', suit: 'C', conf: 0.6, alts: [{ rank: 'K', suit: 'C' }] }], []);
ok('R2 A♣ listed twice → 2 cards, BOTH flagged as conflicting, identities NOT replaced by guesses', m.length === 2 && m.every(c => c.status === 'check' && c.conflict && c.conflict.length === 1 && c.rank + c.suit === 'AC'), m);
// R3: an unreadable entry on top of a read card from the other pass is that card, not an extra one
m = V.mergeDetections([{ box: B(100, 100, 300, 400), rank: 'Q', suit: 'H', conf: 0.9 }], [{ crop: [0, 0, 1, 1], cards: [{ box: B(150, 150, 280, 330), rank: null, suit: null, conf: 0.2 }] }]);
ok('R3 uncertain reading on top of a card → still 1 card (uncertainty never adds a card)', m.length === 1 && m[0].rank === 'Q', m);
// R4: the overview misreads K♣ as A♣ while the crop reads A♣ elsewhere and K♣ at that spot → 2 physical cards, no third
m = V.mergeDetections([{ box: B(600, 600, 700, 800), rank: 'A', suit: 'C', conf: 0.7 }], [{ crop: [0, 0, 1, 1], cards: [{ box: B(100, 100, 200, 300), rank: 'A', suit: 'C', conf: 0.9 }, { box: B(600, 600, 700, 800), rank: 'K', suit: 'C', conf: 0.85 }] }]);
ok('R4 misread at one spot → 2 cards total; the disputed one is flagged with both readings', m.length === 2 && m.some(c => c.status !== 'ok' && [c.rank + c.suit].concat(c.alts).includes('KC') && [c.rank + c.suit].concat(c.alts).includes('AC')), m);
ok('R4 the physical count never exceeds the number of distinct places', m.length === 2);
// R5: re-reading uncertain cards from their own zoomed crop
let cs = [{ id: 1, rank: 'Q', suit: 'H', conf: 0.55, alts: ['QD'], status: 'check', box: B(0, 0, 1, 1) }, { id: 2, rank: 'K', suit: 'S', conf: 0.5, alts: [], status: 'check', box: B(0, 0, 1, 1) },
  { id: 3, rank: '9', suit: 'C', conf: 0.5, alts: [], status: 'check', box: B(0, 0, 1, 1), user: true }, { id: 4, rank: null, suit: null, conf: 0, alts: [], status: 'unreadable', box: B(0, 0, 1, 1) },
  { id: 5, rank: '7', suit: 'D', conf: 0.5, alts: [], status: 'check', box: B(0, 0, 1, 1) }];
V.applyRecheck(cs, cs, [{ i: 1, card: true, rank: 'Q', suit: 'H', conf: 0.9 }, { i: 2, card: true, rank: 'K', suit: 'C', conf: 0.95 }, { i: 3, card: true, rank: 'A', suit: 'S', conf: 0.99 }, { i: 4, card: false }, { i: 5, card: true, rank: '8', suit: 'D', conf: 0.6 }]);
ok('R5 re-read agrees → confirmed', cs[0].status === 'ok');
ok('R5 confident re-read differs → adopted visibly (kept the first reading as "prev")', cs[1].rank + cs[1].suit === 'KC' && cs[1].prev === 'KS' && cs[1].reread);
ok('R5 a card the user confirmed is never changed by a re-read', cs[2].rank + cs[2].suit === '9C');
ok('R5 "not a card" is only flagged, never deleted automatically', cs[3].notCard && cs[3].status === 'check');
ok('R5 unsure re-read → still asks, offering both readings', cs[4].status === 'check' && cs[4].rank === '7' && cs[4].alts[0] === '8D');
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
    const det0 = BalootVision.findCardBlobs(d.data, sm.width, sm.height); const ms = performance.now() - t0;
    // as in scanPhoto(): regions from the photo and from its light-corrected copy
    const e = BalootVision.enhance(canvas, 1600), sm2 = BalootVision.canvasOf(e.canvas, 512), d2 = sm2.getContext('2d').getImageData(0, 0, sm2.width, sm2.height), det1 = BalootVision.findCardBlobs(d2.data, sm2.width, sm2.height);
    const det = { blobs: det0.blobs.concat(det1.blobs.filter(b => !det0.blobs.some(a => BalootVision.iou(a.box, b.box) > 0.5))), reliable: det0.reliable || det1.reliable };
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
    if (!fs.existsSync(file)) { console.log('      (private photo', f, 'not present — skipped)'); continue; }
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

  console.log('\nlight correction (no AI): dark, warm, uneven, blurry photos');
  const ll = await p.evaluate(() => BalootSynth.SCENES.filter(x => x.dark || x.warm || x.uneven || x.blur).map(s => {
    const { canvas, truth } = BalootSynth.makeScene(s);
    const cov = src => { const sm = BalootVision.canvasOf(src, 512), d = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height), det = BalootVision.findCardBlobs(d.data, sm.width, sm.height);
      const id = truth.filter(t => t.identifiable); return id.filter(t => { const cx = (t.box[0] + t.box[2]) / 2, cy = (t.box[1] + t.box[3]) / 2; return det.blobs.some(b => cx >= b.box[0] && cx <= b.box[2] && cy >= b.box[1] && cy <= b.box[3]); }).length; };
    const white = src => { const c = BalootVision.canvasOf(src, 800), g = c.getContext('2d'); let r = 0, gg = 0, bb = 0, n = 0;
      for (const t of truth.filter(x => x.visible > 0.8)) { const d = g.getImageData(((t.box[0] + t.box[2]) / 2) * c.width - 3, ((t.box[1] + t.box[3]) / 2) * c.height - 3, 6, 6).data; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; } }
      return Math.max(r, gg, bb) / Math.max(1, Math.min(r, gg, bb)); };
    const t0 = performance.now(), e = BalootVision.enhance(canvas, 1600), ms = performance.now() - t0;
    return { name: s.name, n: truth.filter(t => t.identifiable).length, before: cov(canvas), after: cov(e.canvas), castBefore: +white(canvas).toFixed(2), castAfter: +white(e.canvas).toFixed(2), ms: Math.round(ms), w: canvas.width, h: canvas.height };
  }));
  ll.forEach(r => console.log(`      ${r.name}: card regions ${r.before}/${r.n} → ${r.after}/${r.n} · colour cast ${r.castBefore} → ${r.castAfter} · ${r.ms} ms`));
  ok('after correction every readable card is inside a card region in all dark/warm/uneven/blurry scenes', ll.every(r => r.after === r.n), ll);
  ok('correction never loses a region the original photo had', ll.every(r => r.after >= r.before));
  ok('warm (yellow) light: colour cast reduced to under 2 (was 5–10)', ll.filter(r => r.castBefore > 3).every(r => r.castAfter < 2), ll.map(r => [r.name, r.castBefore, r.castAfter]));
  ok('the photo itself is not changed (correction works on a copy)', await p.evaluate(() => { const { canvas } = BalootSynth.makeScene(BalootSynth.SCENES[17]); const g = canvas.getContext('2d'); const a = g.getImageData(0, 0, 50, 50).data.join(); BalootVision.enhance(canvas, 1600); return g.getImageData(0, 0, 50, 50).data.join() === a; }));
  for (const f of ['real1.png', 'real2.png']) {
    if (!fs.existsSync(path.join(__dirname, 'vision-data', f))) { console.log('      (private photo', f, 'not present — skipped; see baloot/README.md)'); continue; }
    const data = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'vision-data', f)).toString('base64');
    const r = await p.evaluate(async ([data, centres]) => {
      const img = new Image(); img.src = data; await img.decode();
      const cv = BalootVision.canvasOf(img, 1200), g = cv.getContext('2d'); // simulate a dim room with a warm bulb
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(255,150,60)'; g.fillRect(0, 0, cv.width, cv.height); g.restore(); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, cv.width, cv.height);
      const look = src => { const sm = BalootVision.canvasOf(src, 512), d = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height); return BalootVision.findCardBlobs(d.data, sm.width, sm.height); };
      const e = BalootVision.enhance(cv, 1600), d1 = look(cv), d2 = look(e.canvas);
      const det = { blobs: d1.blobs.concat(d2.blobs), reliable: d1.reliable || d2.reliable }, crops = BalootVision.cropPlan(det, 8);
      const W = img.naturalWidth, H = img.naturalHeight, inC = c => centres.filter(([x, y]) => c.some(k => x / W >= k[0] && x / W <= k[2] && y / H >= k[1] && y / H <= k[3])).length;
      return { darkOnly: inC(BalootVision.cropPlan(d1, 8)), withCorrection: inC(crops), gains: e.stats.cast };
    }, [data, REAL[f]]);
    ok(`${f} made dim + yellow: all 10 cards inside zoom crops with correction (without: ${r.darkOnly}/10)`, r.withCorrection === 10, r);
  }

  console.log('\nperspective correction: a card photographed at an angle is found and flattened');
  const pc = await p.evaluate(() => {
    const V = BalootVision, out = [];
    const flatCard = (rank, suit) => { const c = document.createElement('canvas'); c.width = 250; c.height = 350; const g = c.getContext('2d'); g.translate(125, 175); BalootSynth.drawCard(g, rank, suit, 250, 350); return c; };
    // render a flat card onto a dark table through a true perspective (corner positions in pixels, TL TR BR BL)
    const scene = (card, quad, extra) => {
      const W = 1000, H = 800, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
      g.fillStyle = '#1d3b2e'; g.fillRect(0, 0, W, H);
      const td = g.getImageData(0, 0, W, H), sd = card.getContext('2d').getImageData(0, 0, card.width, card.height).data;
      const Hm = V.homography(quad, [[0, 0], [card.width, 0], [card.width, card.height], [0, card.height]]);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const w = Hm[6] * x + Hm[7] * y + 1, u = (Hm[0] * x + Hm[1] * y + Hm[2]) / w, v = (Hm[3] * x + Hm[4] * y + Hm[5]) / w;
        if (u >= 0 && v >= 0 && u < card.width - 1 && v < card.height - 1) { const si = ((v | 0) * card.width + (u | 0)) * 4, di = (y * W + x) * 4; if (sd[si + 3] < 128) continue; td.data[di] = sd[si]; td.data[di + 1] = sd[si + 1]; td.data[di + 2] = sd[si + 2]; } }
      g.putImageData(td, 0, 0); if (extra) extra(g); return cv;
    };
    const diff = (a, b) => { const A = V.canvasOf(a, 60), Bc = document.createElement('canvas'); Bc.width = A.width; Bc.height = A.height; Bc.getContext('2d').drawImage(b, 0, 0, A.width, A.height);
      const x = A.getContext('2d').getImageData(0, 0, A.width, A.height).data, y = Bc.getContext('2d').getImageData(0, 0, A.width, A.height).data; let s = 0; for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]); return s / (x.length / 4) / 3; };
    const cases = [
      ['tilted away (top narrower)', [[420, 230], [580, 230], [640, 560], [360, 560]]],
      ['tilted sideways (right side nearer)', [[400, 250], [610, 200], [610, 600], [400, 550]]],
      ['tilted and turned', [[380, 300], [560, 210], [690, 470], [470, 590]]],
      ['lying sideways, tilted', [[300, 330], [700, 290], [720, 520], [280, 500]]],
    ];
    for (const [name, quad] of cases) {
      const card = flatCard('9', 'H'), cv = scene(card, quad);
      const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]), box = [Math.min(...xs) / 1000, Math.min(...ys) / 800, Math.max(...xs) / 1000, Math.max(...ys) / 800];
      const q = V.cardQuad(cv, box);
      const err = q ? Math.max(...q.quad.map(([x, y], i) => Math.min(...quad.map(([tx, ty]) => Math.hypot(x * 1000 - tx, y * 800 - ty))))) : null;
      const flat = q && V.warpCard(cv, q.quad);
      let dFlat = null;
      if (flat) { const inner = document.createElement('canvas'); inner.width = flat.width - 16; inner.height = flat.height - 16; inner.getContext('2d').drawImage(flat, 8, 8, inner.width, inner.height, 0, 0, inner.width, inner.height);
        const cardSideways = name.startsWith('lying'); let ref = card;
        if (cardSideways) { ref = document.createElement('canvas'); ref.width = 250; ref.height = 350; const g = ref.getContext('2d'); g.drawImage(card, 0, 0); } // long side kept vertical either way
        dFlat = Math.min(diff(ref, inner), (() => { const r2 = document.createElement('canvas'); r2.width = 250; r2.height = 350; const g = r2.getContext('2d'); g.translate(250, 350); g.rotate(Math.PI); g.drawImage(ref, 0, 0); return diff(r2, inner); })()); }
      const naive = V.canvasOf(cv, 300, box), dNaive = diff(card, naive);
      out.push({ name, found: !!q, cornerErr: err && +err.toFixed(1), dFlat: dFlat && +dFlat.toFixed(1), dNaive: +dNaive.toFixed(1) });
    }
    // a straight-on card is left alone; a card touching another card is not "isolated"
    const card = flatCard('K', 'S');
    const straight = V.cardQuad(scene(card, [[400, 200], [600, 200], [600, 480], [400, 480]]), [0.4, 0.25, 0.6, 0.6]);
    const touching = V.cardQuad(scene(card, [[420, 230], [580, 230], [640, 560], [360, 560]], g => { g.fillStyle = '#FBFBF8'; g.fillRect(600, 300, 200, 280); }), [0.36, 0.29, 0.64, 0.7]);
    return { out, straight, touching };
  });
  pc.out.forEach(r => console.log(`      ${r.name}: corners ${r.found ? 'found, worst error ' + r.cornerErr + ' px' : 'not found'} · difference from the real card: flattened ${r.dFlat} vs plain crop ${r.dNaive}`));
  ok('all 4 angled cards: corners found within 8 px (card ≈ 300 px tall)', pc.out.every(r => r.found && r.cornerErr <= 8), pc.out);
  ok('flattened card is much closer to the real card than the plain crop', pc.out.every(r => r.dFlat < r.dNaive * 0.6), pc.out);
  ok('straight-on card: no correction (nothing changed)', pc.straight === null, pc.straight);
  ok('card touching another card: not treated as isolated (no guess)', pc.touching === null, pc.touching);

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
      out.push({ flagged: r.cards.filter(c => c.status !== 'ok').map(c => c.rank + c.suit + ':' + c.status + (c.colorMismatch ? ':color' : '') + (c.conflict ? ':conf' : '')), name: s.name, ident: sc.identifiable, found: sc.found, falseDet: sc.falseDet, onlyA: seen.a, calls, ms: r.ms, dup: r.cards.length - new Set(r.cards.map(c => c.rank + c.suit)).size });
    }
    return out;
  });
  e2e.forEach(r => console.log(`      [${r.flagged.join(' ')}] ${r.name}: ${r.found}/${r.ident} (overview alone had ${r.onlyA}) · ${r.falseDet} false · ${r.calls} AI calls · ${r.ms} ms`));
  ok('cards the overview missed are recovered from the zoom crops', e2e.every(r => r.found === r.ident) && e2e.some(r => r.onlyA < r.ident), e2e);
  ok('no card counted twice, no invented cards', e2e.every(r => r.dup === 0 && r.falseDet === 0));
  ok('a stub that reads every card right: nothing flagged, two AI calls (overview + crops at the same time)', e2e.every(r => r.calls === 2 && !r.flagged.length), e2e.map(r => [r.name, r.calls, r.flagged]));
  ok('no page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();

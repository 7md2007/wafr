// Speed on a phone-like setup: iPhone 15 screen + touch emulation, CPU slowed with Chrome's throttling (×1, ×4, ×6).
// This is NOT a real iPhone (no Safari, no Apple GPU) — it is a representative estimate. AI time is extra (network + model).
// Run: node tests/baloot.perf.js
const { chromium, devices } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const rows = [];
  for (const rate of [1, 4, 6]) {
    const ctx = await b.newContext({ ...devices['iPhone 15'] }); const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const t0 = Date.now();
    await p.goto('file://' + path.resolve(__dirname, '../baloot/index.html'), { waitUntil: 'load' });
    await p.waitForSelector('#bScan'); const load = Date.now() - t0;
    const r = await p.evaluate(async () => {
      const out = [];
      for (const [name, idx] of [['clear 4 cards', 1], ['8 overlapping', 2], ['dark room', 16], ['warm light', 17], ['32 cards', 15]]) {
        const s = Object.assign({}, BalootSynth.SCENES[idx], { W: 4032, H: 3024 }); // 12-MP photo, like an iPhone camera
        const { canvas, truth } = BalootSynth.makeScene(s);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
        const ai = async () => ({ cards: truth.filter(t => t.identifiable).map(t => ({ box: t.box.map(v => Math.round(v * 1000)), rank: t.rank, suit: t.suit, conf: 0.95 })), crops: [] });
        const times = []; let res;
        for (let k = 0; k < 3; k++) { const t = performance.now(); res = await BalootVision.scanPhoto(blob, ai, { maxImages: 8 }); times.push(performance.now() - t); }
        times.sort((a, b) => a - b); out.push({ name, ms: Math.round(times[1]), light: res.light && res.light.skipped ? 'skipped' : 'corrected' });
      }
      // a full round of scoring + save + render
      const t = performance.now(); for (let i = 0; i < 50; i++) BalootEngine.scoreRound({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 92, projects: [{ type: 'fifty', team: 'us' }] });
      return { scans: out, score50: Math.round(performance.now() - t) };
    });
    rows.push({ rate, load, ...r });
    await ctx.close();
  }
  console.log('CPU      page ready   ' + rows[0].scans.map(s => s.name.padEnd(15)).join('') + ' 50 scorings');
  for (const r of rows) console.log(`×${r.rate}`.padEnd(9) + `${r.load} ms`.padEnd(13) + r.scans.map(s => `${(s.ms / 1000).toFixed(2)} s`.padEnd(15)).join('') + ` ${r.score50} ms`);
  console.log('\n(local photo work only, median of 3; the AI reading adds network + model time — measure it with tests/baloot.ai-eval.js)');
  await b.close();
})();

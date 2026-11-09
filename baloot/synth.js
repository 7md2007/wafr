/* Synthetic card photos with exact ground truth, for measuring card recognition.
   Each scene draws real-looking cards (corner index, pips, picture cards) on a table, with rotation, overlap,
   partial covering, lighting, shadows, distance and perspective. Ground truth records, per card, how much of it is
   visible and whether at least one corner index can be seen ("identifiable"). Deterministic (seeded). */
(function (root) {
  'use strict';
  const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'], SUITS = ['S', 'H', 'D', 'C'];
  const GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' }, RED = { H: 1, D: 1 };
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const PIPS = { '7': [[.3,.2],[.7,.2],[.5,.35],[.3,.5],[.7,.5],[.3,.8],[.7,.8]], '8': [[.3,.2],[.7,.2],[.5,.35],[.3,.5],[.7,.5],[.5,.65],[.3,.8],[.7,.8]],
    '9': [[.3,.2],[.7,.2],[.3,.4],[.7,.4],[.5,.5],[.3,.6],[.7,.6],[.3,.8],[.7,.8]], '10': [[.3,.2],[.7,.2],[.5,.3],[.3,.4],[.7,.4],[.3,.6],[.7,.6],[.5,.7],[.3,.8],[.7,.8]] };
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function drawCard(g, rank, suit, w, h) {
    const col = RED[suit] ? '#C8202B' : '#111';
    g.save(); g.translate(-w / 2, -h / 2);
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = w * 0.06; g.shadowOffsetY = w * 0.02;
    rr(g, 0, 0, w, h, w * 0.07); g.fillStyle = '#FBFBF8'; g.fill(); g.shadowColor = 'transparent';
    g.strokeStyle = '#d6d6d0'; g.lineWidth = Math.max(1, w * 0.008); g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    const idx = () => { g.font = `bold ${w * 0.17}px Arial, sans-serif`; g.fillText(rank, w * 0.13, h * 0.1); g.font = `${w * 0.15}px "DejaVu Sans", Arial, sans-serif`; g.fillText(GLYPH[suit], w * 0.13, h * 0.21); };
    idx(); g.save(); g.translate(w, h); g.rotate(Math.PI); idx(); g.restore();
    if (PIPS[rank]) { g.font = `${w * 0.2}px "DejaVu Sans", Arial, sans-serif`; for (const [px, py] of PIPS[rank]) { g.save(); g.translate(w * (0.18 + px * 0.64), h * py); if (py > 0.55) g.rotate(Math.PI); g.fillText(GLYPH[suit], 0, 0); g.restore(); } }
    else if (rank === 'A') { g.font = `${w * 0.55}px "DejaVu Sans", Arial, sans-serif`; g.fillText(GLYPH[suit], w / 2, h / 2); }
    else { // picture card: framed portrait in suit colours + big letter
      g.fillStyle = RED[suit] ? '#F4D35E' : '#9EC5E8'; g.fillRect(w * 0.22, h * 0.18, w * 0.56, h * 0.64);
      g.strokeStyle = '#2B4C9B'; g.lineWidth = w * 0.015; g.strokeRect(w * 0.22, h * 0.18, w * 0.56, h * 0.64);
      g.fillStyle = col; g.font = `bold ${w * 0.32}px Georgia, serif`; g.fillText(rank, w / 2, h * 0.4);
      g.font = `${w * 0.2}px "DejaVu Sans", Arial, sans-serif`; g.fillText(GLYPH[suit], w / 2, h * 0.64);
    }
    g.restore();
  }
  function corners(c) { // card polygon + its two index points, in image pixels
    const cs = Math.cos(c.a), sn = Math.sin(c.a), sk = c.sk || 0;
    const P = (u, v) => { const x = u * c.w - c.w / 2, y = v * c.h - c.h / 2; return [c.x + (x + sk * y) * cs - y * sn, c.y + (x + sk * y) * sn + y * cs]; };
    return { poly: [P(0, 0), P(1, 0), P(1, 1), P(0, 1)], idx: [P(0.13, 0.15), P(0.87, 0.85)] };
  }
  /* scene: {seed,n,W,H,layout:'spread'|'fan'|'pile'|'grid'|'row',scale,rot,bg:'dark'|'felt'|'wood'|'white',light,shadow,cover,skew,offEdge} */
  function makeScene(s) {
    const R = rng(s.seed || 1), W = s.W || 1600, H = s.H || 1200;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    const BG = { dark: ['#3b3f42', '#2a2d30'], felt: ['#1f5a3a', '#17442c'], wood: ['#7a5232', '#5b3b22'], white: ['#e9e7e1', '#d9d6cf'] }[s.bg || 'dark'];
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, BG[0]); gr.addColorStop(1, BG[1]); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${R() < .5 ? '255,255,255' : '0,0,0'},${R() * 0.06})`; g.fillRect(R() * W, R() * H, 2 + R() * 30, 1 + R() * 6); }
    // deal unique cards
    const deck = []; for (const su of SUITS) for (const rk of RANKS) deck.push([rk, su]);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const n = Math.min(32, s.n || 8), cw = Math.min(W, H) * (s.scale || 0.2), ch = cw * 1.4, rot = s.rot == null ? 0.5 : s.rot, cards = [];
    for (let i = 0; i < n; i++) {
      let x, y, a = (R() - 0.5) * 2 * rot;
      const L = s.layout || 'spread';
      if (L === 'grid') { const cols = Math.ceil(Math.sqrt(n * W / H)), rows = Math.ceil(n / cols); x = W * ((i % cols) + 0.5) / cols; y = H * (Math.floor(i / cols) + 0.5) / rows; }
      else if (L === 'fan') { const t = n > 1 ? i / (n - 1) - 0.5 : 0; a = t * 1.3; x = W / 2 + Math.sin(a) * ch * 0.9; y = H * 0.62 - Math.cos(a) * ch * 0.4; }
      else if (L === 'pile') { x = W / 2 + (R() - 0.5) * cw * 1.6; y = H / 2 + (R() - 0.5) * ch * 1.2; }
      else if (L === 'row') { x = W * (i + 1) / (n + 1); y = H / 2 + (R() - 0.5) * ch * 0.3; a = (R() - 0.5) * 0.25; }
      else { x = cw * 0.7 + R() * (W - cw * 1.4); y = ch * 0.6 + R() * (H - ch * 1.2); }
      if (s.offEdge && i === 0) { x = W - cw * 0.15; }
      cards.push({ rank: deck[i][0], suit: deck[i][1], x, y, a, w: cw, h: ch, sk: s.skew ? (R() - 0.5) * s.skew : 0 });
    }
    for (const c of cards) { g.save(); g.translate(c.x, c.y); g.rotate(c.a); if (c.sk) g.transform(1, 0, c.sk, 1, 0, 0); drawCard(g, c.rank, c.suit, c.w, c.h); g.restore(); }
    // things covering cards (a phone, a hand…)
    const covers = [];
    for (let i = 0; i < (s.cover || 0); i++) { const c = cards[Math.floor(R() * n)]; const r = [c.x - cw * 0.1, c.y - ch * (0.1 + R() * 0.4), cw * (0.5 + R() * 0.5), ch * (0.4 + R() * 0.3)]; covers.push(r);
      g.fillStyle = '#26282b'; rr(g, r[0], r[1], r[2], r[3], cw * 0.08); g.fill(); }
    // lighting: vignette, a soft shadow band, global dimming
    if (s.light) { const v = g.createRadialGradient(W * 0.3, H * 0.3, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${0.35 * s.light})`); g.fillStyle = v; g.fillRect(0, 0, W, H);
      g.fillStyle = `rgba(0,0,0,${0.25 * s.light})`; g.fillRect(0, 0, W, H); }
    if (s.shadow) { g.save(); g.translate(W * 0.5, H * 0.5); g.rotate(-0.6); g.fillStyle = `rgba(0,0,0,${0.35 * s.shadow})`; g.fillRect(-W, -H * 0.12, W * 2, H * 0.24); g.restore(); }
    // visibility from an id mask
    const m = document.createElement('canvas'); m.width = W >> 2; m.height = H >> 2; const mg = m.getContext('2d'); mg.imageSmoothingEnabled = false;
    mg.fillStyle = '#000'; mg.fillRect(0, 0, m.width, m.height);
    const geo = cards.map(corners);
    geo.forEach((q, i) => { mg.fillStyle = `rgb(${i + 1},0,0)`; mg.beginPath(); q.poly.forEach(([x, y], k) => (k ? mg.lineTo(x / 4, y / 4) : mg.moveTo(x / 4, y / 4))); mg.closePath(); mg.fill(); });
    mg.fillStyle = '#000'; covers.forEach(r => mg.fillRect(r[0] / 4, r[1] / 4, r[2] / 4, r[3] / 4));
    const px = mg.getImageData(0, 0, m.width, m.height).data, vis = new Array(n).fill(0);
    for (let i = 0; i < px.length; i += 4) if (px[i] && !px[i + 1] && !px[i + 2]) vis[px[i] - 1]++;
    const at = (x, y) => { const X = Math.round(x / 4), Y = Math.round(y / 4); if (X < 0 || Y < 0 || X >= m.width || Y >= m.height) return 0; return px[(Y * m.width + X) * 4]; };
    const truth = cards.map((c, i) => {
      const full = (c.w * c.h) / 16, q = geo[i];
      const xs = q.poly.map(p => p[0]), ys = q.poly.map(p => p[1]);
      const box = [Math.max(0, Math.min(...xs) / W), Math.max(0, Math.min(...ys) / H), Math.min(1, Math.max(...xs) / W), Math.min(1, Math.max(...ys) / H)];
      const cornerSeen = q.idx.some(([x, y]) => at(x, y) === i + 1);
      const visible = Math.min(1, vis[i] / full);
      return { rank: c.rank, suit: c.suit, box, visible: +visible.toFixed(2), cornerSeen, identifiable: visible >= 0.2 && cornerSeen };
    });
    return { canvas: cv, truth, scene: s };
  }
  const SCENES = [
    { name: 'بطاقة وحدة واضحة', seed: 11, n: 1, scale: 0.35, rot: 0.2 },
    { name: 'أكلة (4) واضحة', seed: 12, n: 4, layout: 'row', scale: 0.22 },
    { name: 'يد مفرودة متداخلة (8)', seed: 13, n: 8, layout: 'fan', scale: 0.24 },
    { name: 'مدوّرة ومائلة (8)', seed: 14, n: 8, rot: 1.6, scale: 0.17 },
    { name: 'مغطاة جزئياً (6)', seed: 15, n: 6, cover: 2, scale: 0.2, offEdge: true },
    { name: 'أحمر وأسود مختلط (10)', seed: 16, n: 10, scale: 0.16, rot: 0.8 },
    { name: 'إضاءة ضعيفة (8)', seed: 17, n: 8, light: 1, scale: 0.18 },
    { name: 'ظل على الأوراق (8)', seed: 18, n: 8, shadow: 1, scale: 0.18 },
    { name: 'من بعيد — أوراق صغيرة (10)', seed: 19, n: 10, scale: 0.09, rot: 0.6 },
    { name: 'كومة متداخلة (12)', seed: 20, n: 12, layout: 'pile', scale: 0.2, rot: 1 },
    { name: 'زاوية تصوير مائلة (8)', seed: 21, n: 8, skew: 0.5, scale: 0.17 },
    { name: 'طاولة خضراء (16)', seed: 22, n: 16, bg: 'felt', layout: 'grid', scale: 0.15, rot: 0.3 },
    { name: 'طاولة خشب (12)', seed: 23, n: 12, bg: 'wood', scale: 0.15 },
    { name: 'طاولة بيضاء (6)', seed: 24, n: 6, bg: 'white', scale: 0.2 },
    { name: '24 ورقة', seed: 25, n: 24, layout: 'grid', scale: 0.12, rot: 0.25 },
    { name: 'كل الورق (32)', seed: 26, n: 32, layout: 'grid', scale: 0.11, rot: 0.2 },
  ];
  /* compare a recognition result with the truth */
  function score(truth, cards) {
    const key = c => c.rank + c.suit;
    const ident = truth.filter(t => t.identifiable), truthKeys = new Set(truth.map(key));
    const predOK = cards.filter(c => c.rank && c.suit && c.status !== 'removed');
    const predKeys = new Set(predOK.map(key));
    const found = ident.filter(t => predKeys.has(key(t))).length;
    const falseDet = predOK.filter(c => !truthKeys.has(key(c))).length;
    // rank / suit accuracy: each identifiable truth card vs the prediction whose box centre falls inside it
    let rk = 0, su = 0, located = 0;
    for (const t of ident) {
      const p = cards.find(c => { const cx = (c.box[0] + c.box[2]) / 2, cy = (c.box[1] + c.box[3]) / 2; return cx >= t.box[0] && cx <= t.box[2] && cy >= t.box[1] && cy <= t.box[3] && c.rank && c.suit && key(c) === key(t); })
        || cards.find(c => { const cx = (c.box[0] + c.box[2]) / 2, cy = (c.box[1] + c.box[3]) / 2; return cx >= t.box[0] && cx <= t.box[2] && cy >= t.box[1] && cy <= t.box[3]; });
      if (!p) continue; located++; if (p.rank === t.rank) rk++; if (p.suit === t.suit) su++;
    }
    return { identifiable: ident.length, found, falseDet, located, rankOK: rk, suitOK: su, complete: found === ident.length && falseDet === 0 };
  }
  const api = { SCENES, makeScene, score, drawCard, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BalootSynth = api;
})(typeof self !== 'undefined' ? self : this);

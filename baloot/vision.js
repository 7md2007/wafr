/* Baloot card recognition pipeline.
   1. Local image analysis (no AI): find bright card regions (cards are light, low-saturation shapes on a darker table),
      fill their holes, label connected regions, estimate how many cards each region holds.
   2. AI pass A — the whole photo (high resolution): every physical card with a box + rank/suit + confidence.
   3. AI pass B — zoomed crops of each card region cut from the FULL-resolution photo (small and overlapping cards
      become large and readable). A and B run at the same time.
   4. Merge: boxes that overlap (or the same identity close by) are one physical card; votes decide the identity;
      the 32-card deck rule (each card exists once) is enforced; disagreement or low confidence → "check".
   Pure functions (findCardBlobs, mergeDetections, …) have no DOM and are unit-tested; scanPhoto() uses canvas. */
(function (root) {
  'use strict';
  const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'], SUITS = ['S', 'H', 'D', 'C'];

  /* ---------- 1. local card-region detector ---------- */
  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }
  // square-window dilate/erode with an integral image (r = radius in pixels)
  function morph(mask, w, h, r, erode) {
    const I = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += mask[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
      const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = erode ? (s === (x1 - x0) * (y1 - y0) ? 1 : 0) : (s > 0 ? 1 : 0);
    }
    return out;
  }
  /* rgba: Uint8ClampedArray of a small (≈512 px) copy of the photo. Returns normalized boxes [x0,y0,x1,y1] (0..1). */
  function findCardBlobs(rgba, w, h) {
    const n = w * h, lum = new Uint8Array(n), hist = new Uint32Array(256), satOk = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      const L = (r * 299 + g * 587 + b * 114) / 1000 | 0; lum[i] = L; hist[L]++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satOk[i] = mx === 0 || (mx - mn) / mx < 0.28 ? 1 : 0;
    }
    // cards are the near-white things: the cut is the higher of Otsu's split and "close to the brightest 1% of pixels",
    // so a light grey table or a bright patch on it is not mistaken for card
    let acc = 0, p99 = 255; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.01) { p99 = i; break; } }
    const t = Math.max(otsu(hist, n), 90, p99 - 48);
    // local contrast: a card in a shadow is darker than a card in the light, but still much brighter than the table
    // right next to it (average over a wide window)
    const rad = Math.max(4, Math.round(Math.min(w, h) / 10)), Il = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum[y * w + x]; Il[(y + 1) * (w + 1) + x + 1] = Il[y * (w + 1) + x + 1] + row; } }
    const localMean = (x, y) => { const x0 = Math.max(0, x - rad), y0 = Math.max(0, y - rad), x1 = Math.min(w, x + rad + 1), y1 = Math.min(h, y + rad + 1);
      return (Il[y1 * (w + 1) + x1] - Il[y0 * (w + 1) + x1] - Il[y1 * (w + 1) + x0] + Il[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
    let mask = new Uint8Array(n), bright = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!satOk[i]) continue;
      if (lum[i] > t || (lum[i] > 70 && lum[i] > localMean(x, y) * 1.45)) { mask[i] = 1; bright++; }
    }
    const frac = bright / n;
    if (frac < 0.01 || frac > 0.6) return { blobs: [], reliable: false, threshold: t, brightFrac: frac };
    const r = Math.max(1, Math.round(Math.min(w, h) / 200));
    mask = morph(morph(mask, w, h, r, false), w, h, r, true); // close: joins card edges, fills tiny pips
    // fill holes (face pictures, red pips): background = what the image border can reach through non-card pixels
    const reach = new Uint8Array(n), st = new Int32Array(n); let sp = 0;
    const push = i => { if (!mask[i] && !reach[i]) { reach[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) { const i = st[--sp], x = i % w, y = (i / w) | 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
    for (let i = 0; i < n; i++) if (!reach[i]) mask[i] = 1;
    // connected regions
    const lab = new Int32Array(n), comps = []; let id = 0;
    for (let s = 0; s < n; s++) {
      if (!mask[s] || lab[s]) continue;
      id++; let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; sp = 0; st[sp++] = s; lab[s] = id;
      while (sp) {
        const i = st[--sp], x = i % w, y = (i / w) | 0; area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = id; st[sp++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = id; st[sp++] = i + 1; }
        if (y > 0 && mask[i - w] && !lab[i - w]) { lab[i - w] = id; st[sp++] = i - w; }
        if (y < h - 1 && mask[i + w] && !lab[i + w]) { lab[i + w] = id; st[sp++] = i + w; }
      }
      comps.push({ area, x0, y0, x1: x1 + 1, y1: y1 + 1 });
    }
    const minA = n * 0.0025;
    let blobs = comps.filter(c => c.area >= minA && c.area < n * 0.7).map(c => ({
      box: [c.x0 / w, c.y0 / h, c.x1 / w, c.y1 / h], area: c.area / n, solidity: c.area / ((c.x1 - c.x0) * (c.y1 - c.y0)) }));
    // a playing card is a fairly solid shape; very thin or ragged regions (cables, reflections) are dropped
    blobs = blobs.filter(b => b.solidity > 0.3 && Math.min(b.box[2] - b.box[0], b.box[3] - b.box[1]) > 0.03);
    const areas = blobs.map(b => b.area).sort((a, b) => a - b);
    const ref = areas.length ? areas[Math.floor((areas.length - 1) / 2)] : 0; // median region ≈ one card
    blobs.forEach(b => { b.est = Math.max(1, Math.round(b.area / (ref || b.area))); });
    blobs.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
    return { blobs, reliable: blobs.length > 0, threshold: t, brightFrac: frac };
  }

  /* ---------- geometry ---------- */
  const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  function iou(a, b) {
    const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
    const i = area([x0, y0, x1, y1]); const u = area(a) + area(b) - i; return u > 0 ? i / u : 0;
  }
  const center = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const diag = b => Math.hypot(b[2] - b[0], b[3] - b[1]);
  const pad = (b, p) => { const dx = (b[2] - b[0]) * p, dy = (b[3] - b[1]) * p; return [Math.max(0, b[0] - dx), Math.max(0, b[1] - dy), Math.min(1, b[2] + dx), Math.min(1, b[3] + dy)]; };

  /* Which zoomed crops pass B should look at: every card region (padded), big regions split in 4, or 2×2 tiles of the
     whole photo when the local detector is not reliable (e.g. a white table). At most `max` crops. */
  function cropPlan(det, max) {
    max = max || 8;
    let crops = [];
    if (det && det.reliable && det.blobs.length) {
      for (const b of det.blobs) {
        // at least about one card in size around the region (a card half in shadow shows up as a small region)
        let p = pad(b.box, 0.08); const mw = 0.3, mh = 0.3;
        if (p[2] - p[0] < mw) { const c = (p[0] + p[2]) / 2; p = [Math.max(0, c - mw / 2), p[1], Math.min(1, c + mw / 2), p[3]]; }
        if (p[3] - p[1] < mh) { const c = (p[1] + p[3]) / 2; p = [p[0], Math.max(0, c - mh / 2), p[2], Math.min(1, c + mh / 2)]; }
        const big = (p[2] - p[0]) > 0.5 || (p[3] - p[1]) > 0.5;
        if (big) { const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2, ox = (p[2] - p[0]) * 0.08, oy = (p[3] - p[1]) * 0.08;
          crops.push([p[0], p[1], mx + ox, my + oy], [mx - ox, p[1], p[2], my + oy], [p[0], my - oy, mx + ox, p[3]], [mx - ox, my - oy, p[2], p[3]]); }
        else crops.push(p);
      }
    } else crops = [[0, 0, 0.58, 0.58], [0.42, 0, 1, 0.58], [0, 0.42, 0.58, 1], [0.42, 0.42, 1, 1]];
    crops = crops.filter((c, i) => !crops.some((d, j) => j < i && iou(c, d) > 0.6)); // drop near-duplicates
    if (crops.length > max) { // many separate cards: tile the area that holds them, so no region is left out
      const u = crops.reduce((m, c) => [Math.min(m[0], c[0]), Math.min(m[1], c[1]), Math.max(m[2], c[2]), Math.max(m[3], c[3])], [1, 1, 0, 0]);
      const W = u[2] - u[0], H = u[3] - u[1]; let best = [1, max];
      for (let cols = 1; cols <= max; cols++) { const rows = Math.floor(max / cols); if (!rows) break; const sq = Math.abs(Math.log((W / cols) / (H / rows))); if (sq < Math.abs(Math.log((W / best[0]) / (H / best[1])))) best = [cols, rows]; }
      const [cols, rows] = best, ox = W / cols * 0.15, oy = H / rows * 0.15; crops = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        crops.push([Math.max(0, u[0] + c * W / cols - ox), Math.max(0, u[1] + r * H / rows - oy), Math.min(1, u[0] + (c + 1) * W / cols + ox), Math.min(1, u[1] + (r + 1) * H / rows + oy)]);
    }
    return crops;
  }

  /* ---------- 4. merge ---------- */
  const okRank = r => RANKS.includes(r), okSuit = s => SUITS.includes(s);
  function normCard(c) {
    let rank = c && c.rank != null ? String(c.rank).toUpperCase().replace(/^T$/, '10').replace(/^1$/, '10') : null;
    let suit = c && c.suit != null ? String(c.suit).toUpperCase().slice(0, 1) : null;
    if (!okRank(rank)) rank = null; if (!okSuit(suit)) suit = null;
    let conf = Number(c && c.conf); if (!(conf >= 0 && conf <= 1)) conf = 0.5;
    const box = Array.isArray(c && c.box) && c.box.length === 4 && c.box.every(v => Number.isFinite(+v)) ? c.box.map(v => Math.min(1, Math.max(0, +v / 1000))) : null;
    if (box && (box[2] <= box[0] || box[3] <= box[1])) { const t = box.slice(); box[0] = Math.min(t[0], t[2]); box[2] = Math.max(t[0], t[2]); box[1] = Math.min(t[1], t[3]); box[3] = Math.max(t[1], t[3]); }
    const alts = Array.isArray(c && c.alts) ? c.alts.map(a => normCard(Object.assign({ conf: 0.3 }, a))).filter(a => a.rank && a.suit).map(a => a.rank + a.suit) : [];
    return { rank, suit, conf, box, alts };
  }
  /* a: detections from pass A (boxes in photo coords 0..1000); b: [{crop:[x0,y0,x1,y1] 0..1, cards:[…boxes 0..1000 in the crop]}] */
  function mergeDetections(a, b) {
    const all = [];
    (a || []).forEach(c => { const n = normCard(c); if (n.box) all.push(Object.assign(n, { pass: 'A' })); });
    (b || []).forEach((cr, ci) => (cr.cards || []).forEach(c => {
      const n = normCard(c); if (!n.box) return; const k = cr.crop, bx = n.box;
      n.box = [k[0] + bx[0] * (k[2] - k[0]), k[1] + bx[1] * (k[3] - k[1]), k[0] + bx[2] * (k[2] - k[0]), k[1] + bx[3] * (k[3] - k[1])];
      all.push(Object.assign(n, { pass: 'B', src: 'B' + ci }));
    }));
    all.forEach(c => { if (!c.src) c.src = 'A'; });
    // Group detections of the same physical card.
    //  · One answer (the overview, or one crop) lists each card once → two entries of the SAME answer are two cards,
    //    even when their boxes overlap (fans, piles).
    //  · The deck has one copy of each card → the same identity from DIFFERENT answers is the same physical card, even
    //    when the boxes landed apart (box positions from the model are approximate). This used to create a second card.
    //  · An entry nobody could read that sits on top of a read card is that card, not an extra one.
    const key = c => (c.rank && c.suit ? c.rank + c.suit : null);
    const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
    const pairs = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const A = all[i], B = all[j], ov = iou(A.box, B.box), ka = key(A), kb = key(B), cross = A.src !== B.src;
      const near = Math.hypot(center(A.box)[0] - center(B.box)[0], center(A.box)[1] - center(B.box)[1]) < 0.6 * Math.max(diag(A.box), diag(B.box));
      let sc = 0;
      if (ka && ka === kb && (ov > 0.05 || near)) sc = 4 + ov;                                                  // same card, same place
      else if (cross && (!ka || !kb) && (ov >= 0.2 || inside(center(A.box), B.box) || inside(center(B.box), A.box))) sc = 3 + ov; // unreadable on top of a card
      else if (cross && ka !== kb && ov >= 0.7) sc = 2 + ov;                                                    // same place, read differently
      else if (cross && ka && ka === kb) sc = 1;                                                                // same card, box drifted
      if (sc) pairs.push([sc, i, j]);
    }
    pairs.sort((x, y) => y[0] - x[0]);
    const gid = all.map((_, i) => i), mem = all.map((_, i) => [i]);
    const compatible = (g1, g2) => { // a group may hold at most one entry per answer (an identical repeat excepted)
      const bySrc = {};
      for (const i of mem[g1].concat(mem[g2])) { const c = all[i], k = key(c); if (bySrc[c.src] === undefined) bySrc[c.src] = k; else if (bySrc[c.src] !== k || k === null) return false; }
      return true;
    };
    for (const [, i, j] of pairs) {
      const g1 = gid[i], g2 = gid[j]; if (g1 === g2 || !compatible(g1, g2)) continue;
      for (const k of mem[g2]) { gid[k] = g1; mem[g1].push(k); } mem[g2] = [];
    }
    const groups = {};
    all.forEach((c, i) => { (groups[gid[i]] = groups[gid[i]] || []).push(c); });
    const cards = Object.values(groups).map(g => {
      const votes = {};
      g.forEach(c => { const k = key(c); if (k) votes[k] = (votes[k] || 0) + c.conf + (c.pass === 'B' ? 0.05 : 0); });
      const ranked = Object.entries(votes).sort((x, y) => y[1] - x[1]);
      // the box: prefer the zoomed pass (more precise), then the biggest
      const bx = g.filter(c => c.pass === 'B'); const box = (bx.length ? bx : g).reduce((m, c) => (area(c.box) > area(m) ? c.box : m), (bx.length ? bx : g)[0].box);
      const passes = [...new Set(g.map(c => c.pass))];
      if (!ranked.length) { // a card is there but no pass could read rank+suit
        const rk = g.map(c => c.rank).find(Boolean) || null, su = g.map(c => c.suit).find(Boolean) || null;
        return { rank: rk, suit: su, conf: 0, box, alts: [], status: 'unreadable', passes };
      }
      const [best, bv] = ranked[0];
      const agree = g.filter(c => key(c) === best);
      let conf = Math.max(...agree.map(c => c.conf));
      if (new Set(agree.map(c => c.pass)).size > 1) conf = Math.min(1, conf + 0.1); // both passes read the same card
      const rival = ranked[1] && ranked[1][1] >= 0.6 * bv;
      if (rival) conf = Math.min(conf, 0.6);
      const alts = [...new Set(ranked.slice(1).map(x => x[0]).concat(...g.map(c => c.alts)))].filter(k => k !== best).slice(0, 3);
      const both = new Set(agree.map(c => c.pass)).size > 1;
      return { rank: best.slice(0, -1), suit: best.slice(-1), conf: +conf.toFixed(2), box, alts, status: !rival && (conf >= 0.8 || (both && conf >= 0.6)) ? 'ok' : 'check', passes };
    });
    cards.sort((x, y) => x.box[1] - y.box[1] || x.box[0] - y.box[0]);
    cards.forEach((c, i) => { c.id = i + 1; });
    markConflicts(cards);
    return cards;
  }
  /* Deck rule: one copy of each card.
     · two unconfirmed cards with the same identity → BOTH flagged as a conflict (nothing renamed, nothing added);
     · an unconfirmed card that has the identity of a card the user confirmed → it cannot be that card: its reading
       is moved to the suggestions and it asks for its real identity;
     · a card that was flagged only because of a conflict goes back to its own status once the conflict is gone;
     · user-confirmed cards are never changed here. */
  function markConflicts(cards) {
    const live = cards.filter(c => c.status !== 'removed');
    live.forEach(c => { delete c.conflict; });
    const byKey = {};
    live.forEach(c => { if (c.rank && c.suit && c.status !== 'unreadable') (byKey[c.rank + c.suit] = byKey[c.rank + c.suit] || []).push(c); });
    Object.entries(byKey).forEach(([k, list]) => {
      if (list.length < 2) return;
      const users = list.filter(c => c.user);
      if (users.length) {
        list.filter(c => !c.user).forEach(c => { c.alts = [k].concat(c.alts || []).filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 3); c.rank = null; c.suit = null; c.status = 'check'; c.byConflict = false; c.taken = k; });
        if (users.length > 1) users.forEach(c => { c.conflict = users.filter(o => o !== c).map(o => o.id); });
        return;
      }
      list.forEach(c => { c.conflict = list.filter(o => o !== c).map(o => o.id); if (c.status === 'ok') { c.byConflict = true; c.status = 'check'; } });
    });
    live.forEach(c => { if (c.byConflict && !c.conflict) { c.byConflict = false; if (c.status === 'check' && c.rank && c.suit) c.status = 'ok'; } });
    return cards;
  }

  /* Re-read uncertain cards from full-resolution crops. Each card is sent twice — as photographed and with the light
     corrected — turned upright, with the card framed in turquoise. Rank and suit are judged separately. */
  function promptC(n) {
    return `You get ${n} pair${n > 1 ? 's' : ''} of zoomed images from a photo of a Baloot game. Images 1 and 2 are pair 1, images 3 and 4 are pair 2, and so on: the first of each pair is the photo as taken, the second is the same crop with the light, colour and contrast corrected. ${DECK}
In each pair, identify ONLY the card inside the turquoise frame; other cards around it do not matter. Judge the RANK and the SUIT separately: rank from the corner index letter/number (and the number of pips), suit from the symbol shape (♥ rounded top vs ♦ pointed; ♠ pointed top with stem vs ♣ three round leaves) and its colour (♥♦ red, ♠♣ black). This deck has only 7 8 9 10 J Q K A.
If the frame does not contain a playing card, set "card": false. Use null for a rank or suit that is not readable — never guess.
Reply with only JSON: {"cards":[{"i":1,"card":true,"rank":"A|K|Q|J|10|9|8|7"|null,"rank_conf":0.0,"suit":"S|H|D|C"|null,"suit_conf":0.0}]}`;
  }
  // card orientation from the bright region inside the box (second-order moments); returns radians to turn it upright
  function uprightAngle(src, box) {
    try {
      const cv = canvasOf(src, 120, box), g = cv.getContext('2d'), w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data;
      const L = new Uint8Array(w * h), hist = new Uint32Array(256);
      for (let i = 0; i < w * h; i++) { const v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; L[i] = v; hist[v]++; }
      const t = otsu(hist, w * h); let n = 0, sx = 0, sy = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (L[y * w + x] > t) { n++; sx += x; sy += y; }
      if (n < w * h * 0.25 || n > w * h * 0.95) return 0;
      const cx = sx / n, cy = sy / n; let a = 0, b = 0, c = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (L[y * w + x] > t) { const dx = x - cx, dy = y - cy; a += dx * dx; b += dx * dy; c += dy * dy; }
      const th = 0.5 * Math.atan2(2 * b, a - c); // long axis angle from the x axis
      if (Math.abs(a - c) < 0.15 * (a + c) && Math.abs(b) < 0.1 * (a + c)) return 0; // no clear long axis (square-ish region)
      let rot = Math.PI / 2 - th; while (rot > Math.PI / 2) rot -= Math.PI; while (rot < -Math.PI / 2) rot += Math.PI;
      return Math.abs(rot) < 0.08 ? 0 : rot;
    } catch (e) { return 0; }
  }
  function frameCrop(img, box, angle) {
    const area = pad(box, 0.45), cv = canvasOf(img, 768, area), g = cv.getContext('2d');
    const sx = cv.width / (area[2] - area[0]), sy = cv.height / (area[3] - area[1]);
    g.strokeStyle = '#19D3C5'; g.lineWidth = Math.max(3, cv.width / 120);
    g.strokeRect((box[0] - area[0]) * sx, (box[1] - area[1]) * sy, (box[2] - box[0]) * sx, (box[3] - box[1]) * sy);
    if (!angle) return cv;
    const W = Math.ceil(Math.abs(cv.width * Math.cos(angle)) + Math.abs(cv.height * Math.sin(angle))), H = Math.ceil(Math.abs(cv.width * Math.sin(angle)) + Math.abs(cv.height * Math.cos(angle)));
    const out = document.createElement('canvas'); out.width = W; out.height = H; const o = out.getContext('2d');
    o.fillStyle = '#20262a'; o.fillRect(0, 0, W, H); o.translate(W / 2, H / 2); o.rotate(angle); o.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return out;
  }
  /* local colour check of a card region: red ink vs black ink (independent of the AI) */
  function cardColor(src, box) {
    try {
      const inner = [box[0] + (box[2] - box[0]) * 0.12, box[1] + (box[3] - box[1]) * 0.12, box[2] - (box[2] - box[0]) * 0.12, box[3] - (box[3] - box[1]) * 0.12];
      const cv = canvasOf(src, 140, inner), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = cv.width * cv.height;
      // ink only counts when it sits on the white card (the table between tilted cards is dark too)
      const w = cv.width, h = cv.height, W = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); W[i] = mx > 170 && (mx - mn) / mx < 0.3 ? 1 : 0; }
      const I = new Int32Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += W[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
      const onCard = (x, y) => { const r = 4, x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
        return (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) >= 0.45 * (x1 - x0) * (y1 - y0); };
      let red = 0, black = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const isRed = r > 110 && r > g * 1.7 && r > b * 1.5, isBlack = mx < 90 && mx - mn < 35;
        if ((isRed || isBlack) && onCard(x, y)) { if (isRed) red++; else black++; } }
      const rf = red / n, bf = black / n;
      return { red: +rf.toFixed(4), black: +bf.toFixed(4), verdict: rf > 0.006 && rf > 2.5 * bf ? 'red' : bf > 0.006 && bf > 2.5 * rf ? 'black' : null };
    } catch (e) { return { verdict: null }; }
  }
  const suitColor = s => (s === 'H' || s === 'D' ? 'red' : s === 'S' || s === 'C' ? 'black' : null);
  /* Apply a re-read to the cards (pure; unit-tested). User-confirmed cards are never changed. */
  function applyRecheck(cards, targets, answers) {
    const res = Array.isArray(answers) ? answers : [];
    targets.forEach((c, i) => {
      if (c.user) return;
      const a = res.find(x => +x.i === i + 1); if (!a) return;
      c.rechecked = true;
      if (a.card === false) { c.notCard = true; c.status = 'check'; return; }
      const rc = Number.isFinite(+a.rank_conf) ? +a.rank_conf : Number.isFinite(+a.conf) ? +a.conf : 0.5;
      const sc = Number.isFinite(+a.suit_conf) ? +a.suit_conf : Number.isFinite(+a.conf) ? +a.conf : 0.5;
      const n = normCard(Object.assign({ box: [0, 0, 1, 1] }, a, { conf: Math.min(rc, sc) })), k = n.rank && n.suit ? n.rank + n.suit : null, cur = c.rank && c.suit ? c.rank + c.suit : null;
      if (!k) { // part readable: keep what is known as a hint
        if (!cur && (n.rank || n.suit)) { c.rank = c.rank || n.rank; c.suit = c.suit || n.suit; }
        return;
      }
      let conf = n.conf;
      if (['J', 'Q', 'K'].includes(n.rank)) c.color = null;
      if (c.color && suitColor(n.suit) && c.color !== suitColor(n.suit)) { conf = Math.min(conf, 0.5); c.colorMismatch = true; } // the photo's ink colour disagrees
      else if (c.color && suitColor(n.suit) === c.color) conf = Math.min(1, conf + 0.05);
      if (k === cur) { c.conf = +Math.min(1, Math.max(c.conf, conf) + 0.05).toFixed(2); if ((c.conf >= 0.75) && !c.conflict && !c.colorMismatch) c.status = 'ok'; return; }
      // the zoomed look reads it differently: keep both readings visible; adopt only a confident re-read
      c.alts = [...new Set([cur].concat(c.alts || []))].filter(Boolean).filter(x => x !== k).slice(0, 3);
      if (conf >= 0.85) { c.prev = cur; c.rank = n.rank; c.suit = n.suit; c.conf = +conf.toFixed(2); c.status = 'ok'; c.reread = true; }
      else if (!cur) { c.rank = n.rank; c.suit = n.suit; c.conf = +conf.toFixed(2); c.status = 'check'; }
      else { c.status = 'check'; c.alts = [k].concat(c.alts).slice(0, 3); }
    });
    markConflicts(cards);
    return cards;
  }
  async function recheck(img, cards, ai, maxImg, enh) {
    const targets = cards.filter(c => c.status !== 'removed' && !c.user && (c.status !== 'ok' || c.conflict));
    if (!targets.length) return { cards, n: 0 };
    const per = Math.max(1, Math.floor(maxImg / 2)), src2 = enh || img;
    for (let s = 0; s < targets.length; s += per) {
      const part = targets.slice(s, s + per), blobs = [];
      for (const c of part) { const ang = uprightAngle(src2, c.box); blobs.push(await toBlob(frameCrop(img, c.box, ang), 0.9), await toBlob(frameCrop(src2, c.box, ang), 0.9)); }
      try { const r = await ai(promptC(part.length), blobs); applyRecheck(cards, part, r && r.cards); } catch (e) { /* keep the first reading */ }
    }
    return { cards, n: targets.length };
  }

  /* ---------- light correction (non-destructive: returns a new canvas, the photo is untouched) ----------
     Built like a document scanner, using the cards' own white as the reference:
     1 noise: light 3×3 smoothing when the photo is dark (before brightening, so noise is not amplified)
     2 uneven light / shadows: a "white envelope" map — per area, the level of the brightest (card) pixels — and every
       pixel is divided by it. The table stays dark; a card in a shadow becomes as white as one in the light.
     3 white balance + exposure: each colour channel is scaled so the cards' white becomes neutral white
       (removes yellow/orange bulb light; strong casts allowed)
     4 contrast: dark end stretched, gamma lift when the photo is still dark
     5 mild sharpening for slightly blurry photos */
  function enhancePixels(d, w, h) {
    const n = w * h, st = { applied: [] };
    const f = new Float32Array(n * 3);
    let sumL = 0;
    for (let i = 0; i < n; i++) { f[i * 3] = d[i * 4]; f[i * 3 + 1] = d[i * 4 + 1]; f[i * 3 + 2] = d[i * 4 + 2]; sumL += (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; }
    st.meanL = Math.round(sumL / n);
    // 1 denoise dark photos
    const dark = st.meanL < 85; st.dark = dark;
    if (dark) { st.applied.push('denoise'); const c = f.slice();
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let ch = 0; ch < 3; ch++) { let s3 = 0; for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) s3 += c[((y + yy) * w + x + xx) * 3 + ch]; f[(y * w + x) * 3 + ch] = s3 / 9; } }
    const lumAt = i => f[i * 3] * 0.299 + f[i * 3 + 1] * 0.587 + f[i * 3 + 2] * 0.114;
    // 2 white envelope on a coarse grid: brightest level per cell, spread to neighbours, smoothed
    const G = 24, gw = Math.max(2, Math.round(G * w / Math.max(w, h))), gh = Math.max(2, Math.round(G * h / Math.max(w, h)));
    const cell = new Float32Array(gw * gh);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const gi = Math.min(gh - 1, (y * gh / h) | 0) * gw + Math.min(gw - 1, (x * gw / w) | 0), v = lumAt(y * w + x); if (v > cell[gi]) cell[gi] = v; }
    const filt = (src, rad, fn) => { const out = new Float32Array(src.length); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let acc = fn === 'max' ? 0 : 0, c2 = 0;
      for (let yy = Math.max(0, y - rad); yy <= Math.min(gh - 1, y + rad); yy++) for (let xx = Math.max(0, x - rad); xx <= Math.min(gw - 1, x + rad); xx++) { const v = src[yy * gw + xx]; if (fn === 'max') { if (v > acc) acc = v; } else { acc += v; c2++; } }
      out[y * gw + x] = fn === 'max' ? acc : acc / c2; } return out; };
    const env = filt(filt(cell, 2, 'max'), 2, 'mean');
    const sorted = Array.from(env).sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * 0.9)], low = sorted[Math.floor(sorted.length * 0.1)];
    const uneven = top > 20 && low / top < 0.8;
    if (uneven) {
      st.applied.push('shadow-reduction');
      for (let y = 0; y < h; y++) { const gy = Math.min(gh - 1.001, Math.max(0, y * gh / h - 0.5)), y0 = gy | 0, fy = gy - y0;
        for (let x = 0; x < w; x++) { const gx = Math.min(gw - 1.001, Math.max(0, x * gw / w - 0.5)), x0 = gx | 0, fx = gx - x0;
          const v = env[y0 * gw + x0] * (1 - fx) * (1 - fy) + env[y0 * gw + x0 + 1] * fx * (1 - fy) + env[(y0 + 1) * gw + x0] * (1 - fx) * fy + env[(y0 + 1) * gw + x0 + 1] * fx * fy;
          // areas whose brightest pixels are far below the cards' white are bare table: leave them as they are
          const k = v < top * 0.3 ? 1 : Math.min(3, top / v), i = (y * w + x) * 3; f[i] *= k; f[i + 1] *= k; f[i + 2] *= k; } }
    }
    // 3 white balance + exposure from the cards' white (brightest 2% by luminance)
    const lh = new Uint32Array(1024); for (let i = 0; i < n; i++) lh[Math.min(1023, Math.max(0, lumAt(i) * 2 | 0))]++;
    let acc = 0, thr = 1023; for (let i = 1023; i >= 0; i--) { acc += lh[i]; if (acc >= n * 0.02) { thr = i / 2; break; } }
    let r = 0, g = 0, b = 0, m = 0;
    for (let i = 0; i < n; i++) if (lumAt(i) >= thr) { r += f[i * 3]; g += f[i * 3 + 1]; b += f[i * 3 + 2]; m++; }
    let gain = [1, 1, 1];
    if (m) { r /= m; g /= m; b /= m; gain = [245 / Math.max(1, r), 245 / Math.max(1, g), 245 / Math.max(1, b)].map(v => Math.min(8, Math.max(0.85, v))); }
    st.cast = gain.map(v => +v.toFixed(2));
    if (Math.max(...gain) / Math.min(...gain) > 1.08) st.applied.push('white-balance');
    if (Math.min(...gain) > 1.15) st.applied.push('brighten');
    for (let i = 0; i < n; i++) { f[i * 3] *= gain[0]; f[i * 3 + 1] *= gain[1]; f[i * 3 + 2] *= gain[2]; }
    // 4 contrast: stretch the dark end, gamma lift if the middle is still dark
    const h2 = new Uint32Array(256); for (let i = 0; i < n; i++) h2[Math.min(255, Math.max(0, lumAt(i) | 0))]++;
    let lo = 0; acc = 0; for (let i = 0; i < 256; i++) { acc += h2[i]; if (acc >= n * 0.01) { lo = i; break; } }
    acc = 0; let med = 128; for (let i = 0; i < 256; i++) { acc += h2[i]; if (acc >= n / 2) { med = i; break; } }
    lo = Math.min(lo, 60);
    const mn = Math.max(0.02, (med - lo) / Math.max(1, 245 - lo));
    const gamma = mn < 0.3 ? Math.min(1, Math.max(0.6, Math.log(0.3) / Math.log(mn))) : 1;
    if (lo > 8) st.applied.push('contrast');
    const lut = new Uint8ClampedArray(1024);
    for (let i = 0; i < 1024; i++) { const v = Math.min(1, Math.max(0, (i / 2 - lo) / Math.max(1, 248 - lo))); lut[i] = Math.round(4 + 250 * Math.pow(v, gamma)); }
    const o = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { o[i * 4] = lut[Math.min(1023, Math.max(0, f[i * 3] * 2 | 0))]; o[i * 4 + 1] = lut[Math.min(1023, Math.max(0, f[i * 3 + 1] * 2 | 0))]; o[i * 4 + 2] = lut[Math.min(1023, Math.max(0, f[i * 3 + 2] * 2 | 0))]; o[i * 4 + 3] = 255; }
    // 5 mild sharpening
    const out = new Uint8ClampedArray(o);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let ch = 0; ch < 3; ch++) {
      const i = (y * w + x) * 4 + ch; const avg = (o[i - 4] + o[i + 4] + o[i - w * 4] + o[i + w * 4]) / 4; out[i] = o[i] + 0.5 * (o[i] - avg); }
    st.applied.push('sharpen');
    return { data: out, stats: st };
  }
  function enhance(src, maxSide) {
    const cv = canvasOf(src, maxSide || 1600), g = cv.getContext('2d'), id = g.getImageData(0, 0, cv.width, cv.height);
    const r = enhancePixels(id.data, cv.width, cv.height);
    id.data.set(r.data); g.putImageData(id, 0, 0);
    return { canvas: cv, stats: r.stats };
  }

  /* ---------- prompts ---------- */
  const DECK = 'Baloot uses a 32-card deck: ranks A K Q J 10 9 8 7 in suits S (spades ♠), H (hearts ♥), D (diamonds ♦), C (clubs ♣). Each card exists once.';
  function promptA(det) {
    const hints = det && det.reliable && det.blobs.length ? '\nImage analysis found these light regions (boxes 0-1000; a region may hold one card, several overlapping cards, or a non-card object):\n' +
      det.blobs.map((b, i) => `R${i + 1} [${b.box.map(v => Math.round(v * 1000)).join(',')}]`).join('\n') + '\nCards can also lie outside these regions (shadows). Do not assume any number of cards.' : '';
    return `You are a careful playing-card detector. ${DECK}
Step 1 — find EVERY physical playing card in the photo: upright, rotated, tilted, overlapping, partly covered, at the edges, near or far. A card's two corner indices belong to the same single card; never list one physical card twice. Ignore anything that is not a playing card (keyboards, tables, papers).
Step 2 — for each card give its bounding box [x0,y0,x1,y1] in 0-1000 image coordinates (x to the right, y down), then read rank and suit from the corner index, the pips or the face picture.
Use null for rank or suit you cannot read with certainty — never guess. conf = how sure you are of the rank+suit (0-1). alts = up to 2 other likely identities when unsure.${hints}
Reply with only JSON: {"cards":[{"box":[x0,y0,x1,y1],"rank":"A|K|Q|J|10|9|8|7"|null,"suit":"S|H|D|C"|null,"conf":0.0,"alts":[{"rank":"","suit":""}]}]}`;
  }
  function promptB(n) {
    return `You get ${n} zoomed crop${n > 1 ? 's' : ''} of one photo of Baloot playing cards (crop 1 is the first image, crop 2 the second, …). ${DECK}
For EACH crop, list every playing card whose body is inside it, including rotated, overlapping and partly covered cards. Cards cut by the crop edge: include them only if the rank or suit is visible in this crop. Give each card's box [x0,y0,x1,y1] in 0-1000 coordinates OF THAT CROP, its rank and suit (null when not readable with certainty — never guess), conf 0-1, and up to 2 alts when unsure. A crop with no playing card gets an empty list.
Reply with only JSON: {"crops":[{"i":1,"cards":[{"box":[x0,y0,x1,y1],"rank":"A|K|Q|J|10|9|8|7"|null,"suit":"S|H|D|C"|null,"conf":0.0,"alts":[{"rank":"","suit":""}]}]}]}`;
  }

  /* ---------- browser pipeline ---------- */
  function canvasOf(src, maxSide, box) {
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    const b = box || [0, 0, 1, 1];
    const sx = b[0] * sw, sy = b[1] * sh, cw = (b[2] - b[0]) * sw, ch = (b[3] - b[1]) * sh;
    const k = Math.min(maxSide / Math.max(cw, ch), box ? 3 : 1); // crops may be enlarged up to 3× so small cards become readable
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(cw * k)); cv.height = Math.max(1, Math.round(ch * k));
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
    return cv;
  }
  const toBlob = (cv, q) => new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', q || 0.88));
  async function decode(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
    return await new Promise((res, rej) => { const img = new Image(), u = URL.createObjectURL(file); img.onload = () => res(img); img.onerror = rej; img.src = u; });
  }
  /* ai(prompt, blobs[]) → parsed JSON. maxImages = images allowed per call. */
  async function scanPhoto(file, ai, opts) {
    opts = opts || {};
    const t0 = performance.now(), maxImg = Math.max(1, opts.maxImages || 8);
    const img = await decode(file);
    const enh = enhance(img, 1600); // light-corrected copy; the photo itself is not changed
    const look = src => { const sm = canvasOf(src, 512), d = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height); return findCardBlobs(d.data, sm.width, sm.height); };
    const d1 = look(img), d2 = look(enh.canvas);
    // card regions from both versions (a dark or warm photo hides regions the corrected one shows, and vice versa)
    const blobs = d1.blobs.concat(d2.blobs.filter(b => !d1.blobs.some(a => iou(a.box, b.box) > 0.5)));
    const det = { blobs, reliable: d1.reliable || d2.reliable };
    const tLocal = performance.now() - t0;
    const crops = cropPlan(det, Math.min(8, maxImg));
    const fullBlob = await toBlob(canvasOf(img, 2048), 0.88);
    const cropBlobs = await Promise.all(crops.map(c => toBlob(canvasOf(enh.canvas, 1024, c), 0.9)));
    const callA = ai(promptA(det), [fullBlob]).catch(e => ({ __err: e }));
    const callB = crops.length ? ai(promptB(crops.length), cropBlobs).catch(e => ({ __err: e })) : Promise.resolve({ crops: [] });
    const [ra, rb] = await Promise.all([callA, callB]);
    if (ra && ra.__err && rb && rb.__err) throw ra.__err;
    const a = ra && !ra.__err && Array.isArray(ra.cards) ? ra.cards : [];
    const bl = rb && !rb.__err && Array.isArray(rb.crops) ? rb.crops.map(x => ({ crop: crops[(+x.i || 0) - 1], cards: x.cards })).filter(x => x.crop) : [];
    const cards = mergeDetections(a, bl);
    // independent ink-colour check of every card (red vs black): a suit of the wrong colour is never accepted silently
    const overlapFrac = (a, b) => { const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]); return area([x0, y0, x1, y1]) / Math.max(1e-6, area(a)); };
    for (const c of cards) { if (['J', 'Q', 'K'].includes(c.rank)) continue; // picture cards mix colours in the artwork
      if (cards.some(o => o !== c && overlapFrac(c.box, o.box) > 0.15)) continue; // overlapped: the box holds other cards' ink
      const cc = cardColor(enh.canvas, c.box); c.color = cc.verdict; if (c.color && c.suit && suitColor(c.suit) !== c.color && c.status === 'ok') { c.status = 'check'; c.colorMismatch = true; } }
    const t1 = performance.now();
    const rc = await recheck(img, cards, ai, Math.min(8, maxImg), enh.canvas);
    // a zoomed, light-corrected picture of every card for the correction view
    for (const c of cards) { try { c.zoom = canvasOf(enh.canvas, 360, pad(c.box, 0.12)).toDataURL('image/jpeg', 0.85); } catch (e) {} }
    return { cards, det, crops, ms: Math.round(performance.now() - t0), msLocal: Math.round(tLocal), msRecheck: Math.round(performance.now() - t1), rechecked: rc.n,
      passA: !ra.__err, passB: !rb.__err, width: img.width, height: img.height, img, enh: enh.canvas, light: enh.stats };
  }

  const api = { RANKS, SUITS, findCardBlobs, iou, cropPlan, mergeDetections, markConflicts, applyRecheck, recheck, frameCrop, uprightAngle, cardColor, enhance, enhancePixels, normCard, promptA, promptB, promptC, scanPhoto, canvasOf, decode, pad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BalootVision = api;
})(typeof self !== 'undefined' ? self : this);

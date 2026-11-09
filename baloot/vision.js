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
    // Group detections of the same physical card. One answer (the overview, or one crop) lists each card once, so two
    // different entries of the same answer are two different cards — even when their boxes overlap (fans, piles).
    const key = c => (c.rank && c.suit ? c.rank + c.suit : null);
    const pairs = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const A = all[i], B = all[j], ov = iou(A.box, B.box), ka = key(A), kb = key(B);
      const near = Math.hypot(center(A.box)[0] - center(B.box)[0], center(A.box)[1] - center(B.box)[1]) < 0.6 * Math.max(diag(A.box), diag(B.box));
      let sc = 0;
      if (ka && ka === kb && (ov > 0.05 || near)) sc = 3 + ov;                      // same card read the same way
      else if (A.src !== B.src && (!ka || !kb) && ov >= 0.35) sc = 2 + ov;         // one answer could not read it
      else if (A.src !== B.src && ka !== kb && ov >= 0.7) sc = 1 + ov;             // same place, read differently
      if (sc) pairs.push([sc, i, j]);
    }
    pairs.sort((x, y) => y[0] - x[0]);
    const gid = all.map((_, i) => i), mem = all.map((_, i) => [i]);
    const compatible = (g1, g2) => { // a group may hold at most one card per answer (identical repeats excepted)
      const bySrc = {};
      for (const i of mem[g1].concat(mem[g2])) { const c = all[i], k = key(c); if (bySrc[c.src] === undefined) bySrc[c.src] = k; else if (bySrc[c.src] !== k || k === null) return false; }
      return true;
    };
    for (const [, i, j] of pairs) {
      const g1 = gid[i], g2 = gid[j]; if (g1 === g2 || !compatible(g1, g2)) continue;
      for (const k of mem[g2]) { gid[k] = g1; mem[g1].push(k); } mem[g2] = [];
    }
    const f = i => gid[i];
    const groups = {};
    all.forEach((c, i) => { (groups[f(i)] = groups[f(i)] || []).push(c); });
    let cards = Object.values(groups).map(g => {
      const votes = {};
      g.forEach(c => { const k = key(c); if (k) votes[k] = (votes[k] || 0) + c.conf + (c.pass === 'B' ? 0.05 : 0); });
      const ranked = Object.entries(votes).sort((x, y) => y[1] - x[1]);
      const box = g.reduce((m, c) => (area(c.box) > area(m) ? c.box : m), g[0].box);
      const passes = new Set(g.map(c => c.pass));
      if (!ranked.length) { // a card is there but no pass could read rank+suit
        const rk = g.map(c => c.rank).find(Boolean) || null, su = g.map(c => c.suit).find(Boolean) || null;
        return { rank: rk, suit: su, conf: 0, box, alts: [], status: 'unreadable', passes: [...passes] };
      }
      const [best, bv] = ranked[0];
      const agree = g.filter(c => key(c) === best);
      let conf = Math.max(...agree.map(c => c.conf));
      if (new Set(agree.map(c => c.pass)).size > 1) conf = Math.min(1, conf + 0.1); // both passes read the same card
      const rival = ranked[1] && ranked[1][1] >= 0.6 * bv;
      if (rival) conf = Math.min(conf, 0.6);
      const alts = [...new Set(ranked.slice(1).map(x => x[0]).concat(...g.map(c => c.alts)))].filter(k => k !== best).slice(0, 3);
      return { rank: best.slice(0, -1), suit: best.slice(-1), conf: +conf.toFixed(2), box, alts, status: conf >= 0.8 && !rival ? 'ok' : 'check', passes: [...passes] };
    });
    // deck rule: every card exists once. Two separate regions with the same identity → keep the stronger, flag the other.
    const byKey = {};
    cards.forEach(c => { if (c.rank && c.suit && c.status !== 'unreadable') (byKey[c.rank + c.suit] = byKey[c.rank + c.suit] || []).push(c); });
    Object.entries(byKey).forEach(([k, list]) => {
      if (list.length < 2) return;
      list.sort((x, y) => y.conf - x.conf);
      list.slice(1).forEach(c => {
        const alt = c.alts.find(a => !byKey[a]);
        c.dupOf = k; c.status = 'check'; c.conf = Math.min(c.conf, 0.4);
        if (alt) { c.alts = [k].concat(c.alts.filter(a => a !== alt)); c.rank = alt.slice(0, -1); c.suit = alt.slice(-1); }
        else { c.alts = [k].concat(c.alts); c.rank = null; c.suit = null; c.status = 'unreadable'; }
      });
    });
    cards.sort((x, y) => x.box[1] - y.box[1] || x.box[0] - y.box[0]);
    cards.forEach((c, i) => { c.id = i + 1; });
    return cards;
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
    const small = canvasOf(img, 512), d = small.getContext('2d').getImageData(0, 0, small.width, small.height);
    const det = findCardBlobs(d.data, small.width, small.height);
    const tLocal = performance.now() - t0;
    const crops = cropPlan(det, Math.min(8, maxImg));
    const fullBlob = await toBlob(canvasOf(img, 2048), 0.88);
    const cropBlobs = await Promise.all(crops.map(c => toBlob(canvasOf(img, 1024, c), 0.9)));
    const callA = ai(promptA(det), [fullBlob]).catch(e => ({ __err: e }));
    const callB = crops.length ? ai(promptB(crops.length), cropBlobs).catch(e => ({ __err: e })) : Promise.resolve({ crops: [] });
    const [ra, rb] = await Promise.all([callA, callB]);
    if (ra && ra.__err && rb && rb.__err) throw ra.__err;
    const a = ra && !ra.__err && Array.isArray(ra.cards) ? ra.cards : [];
    const bl = rb && !rb.__err && Array.isArray(rb.crops) ? rb.crops.map(x => ({ crop: crops[(+x.i || 0) - 1], cards: x.cards })).filter(x => x.crop) : [];
    const cards = mergeDetections(a, bl);
    // a zoomed picture of every card for the correction view
    for (const c of cards) { try { c.zoom = canvasOf(img, 360, pad(c.box, 0.12)).toDataURL('image/jpeg', 0.85); } catch (e) {} }
    return { cards, det, crops, ms: Math.round(performance.now() - t0), msLocal: Math.round(tLocal), passA: !ra.__err, passB: !rb.__err, width: img.width, height: img.height };
  }

  const api = { RANKS, SUITS, findCardBlobs, iou, cropPlan, mergeDetections, normCard, promptA, promptB, scanPhoto, canvasOf, decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BalootVision = api;
})(typeof self !== 'undefined' ? self : this);

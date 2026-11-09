// Baloot page tests (Playwright, iPhone-size) — run: node tests/baloot.ui.test.js
// AI card reading is replaced by a stub that returns a fixed card list: this checks the app's handling of a reply, not real recognition.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../baloot/index.html');
let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, i !== undefined ? JSON.stringify(i) : '') } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    window.__cards = [['A', 'S'], ['10', 'S'], ['K', 'S'], ['Q', 'S'], ['A', 'H'], ['10', 'H'], ['K', 'H'], ['Q', 'H'], ['A', 'S']];
    // stub in the shape the real model answers: the overview lists cards with boxes; the crop pass answers per crop.
    // A card listed twice gets the same box (one physical card read twice). window.__conf can lower one card's confidence.
    const boxOf = (k, keys) => { const i = keys.indexOf(k); return [40 + (i % 8) * 120, 100 + Math.floor(i / 8) * 400, 140 + (i % 8) * 120, 450 + Math.floor(i / 8) * 400]; };
    window.claude = { use: async n => n === 'sample' ? Object.assign(async () => ({ text: '' }), { limits: async () => ({ images: { maxCount: 8 } }), json: async (prompt) => {
      const keys = window.__cards.map(([r, s]) => r + s);
      window.__prompts = (window.__prompts || []).concat([/turquoise frame/.test(prompt) ? 'C' : /zoomed crop/.test(prompt) ? 'B' : 'A']);
      if (/turquoise frame/.test(prompt)) return window.__recheck ? window.__recheck() : { cards: [] };
      if (/zoomed crop/.test(prompt)) return window.__passB ? window.__passB() : { crops: [] };
      if (window.__passA) return window.__passA();
      return { cards: window.__cards.map(([rank, suit]) => ({ box: boxOf(rank + suit, keys), rank, suit, conf: (window.__conf && window.__conf[rank + suit]) || 0.95, alts: (window.__alts && window.__alts[rank + suit]) || [] })) };
    } }) : null };
  });
  await p.goto(URL); await p.waitForTimeout(300);
  const txt = s => p.textContent(s);
  const score = async () => [await txt('#sUs'), await txt('#sThem')].join('-');
  const wait = ms => p.waitForTimeout(ms);
  const openGrid = async () => { await p.evaluate(() => { const g = document.querySelector('.gridbox'); if (g && !g.open) { g.open = true; P.gridOpen = true; } }); };
  const closeSh = async () => { await p.click('.sh-x[data-a=close]'); await wait(380); };
  const manual = async (team, digits) => { await p.click('#bManual'); await wait(380); if (team) await p.click(`#segTeam [data-v=${team}]`); for (const d of digits) await p.click(`.keys [data-v="${d}"]`); };

  console.log('main screen');
  ok('Sun selected by default, no suits, buyer لنا', await p.getAttribute('#segMode [data-v=sun]', 'aria-pressed') === 'true' && await p.isHidden('#suits .suit') === false && (await p.getAttribute('#suits', 'class')).includes('off') && await p.getAttribute('#segBuyer [data-v=us]', 'aria-pressed') === 'true');
  ok('Sun at 0–0: no doubling offered', (await txt('#lvBox')).includes('100') && !(await p.$('#segLv')));
  ok('no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  console.log('manual entry');
  await p.click('#bManual'); await wait(380);
  const order = await p.$$eval('.keys button', x => x.map(b => b.textContent.trim()).join(' '));
  ok('keypad order 1 2 3 / 4 5 6 / 7 8 9 / مسح 0 ⌫', order === '1 2 3 4 5 6 7 8 9 مسح 0 ⌫', order);
  const pos = await p.$$eval('.keys button', x => x.map(b => Math.round(b.getBoundingClientRect().left)));
  ok('1 is on the left, 3 on the right (not reversed by RTL)', pos[0] < pos[1] && pos[1] < pos[2] && pos[9] < pos[10] && pos[10] < pos[11], pos);
  for (const d of '1234567890') await p.click(`.keys [data-v="${d}"]`);
  ok('digits type in order, max 3', (await txt('#mBig')) === '123');
  await p.click('[data-a=back]'); ok('⌫ removes the last digit', (await txt('#mBig')) === '12');
  await p.click('[data-a=clr]'); await p.click('.keys [data-v="0"]'); await p.click('.keys [data-v="5"]');
  ok('مسح clears; a leading 0 is dropped', (await txt('#mBig')) === '5');
  await closeSh();
  await manual('us', '70');
  let t = await txt('#mRes'); ok('Sun 70 → +14 / +12', t.includes('+14') && t.includes('+12'), t);
  ok('shows both teams\' abnat', (await txt('#mSplit')).includes('لنا 70') && (await txt('#mSplit')).includes('لهم 60'));
  await p.click('#mGo'); await p.click('#mGo').catch(() => {}); await wait(600);
  ok('saved once (double tap ignored)', await score() === '14-12' && await p.evaluate(() => S.rounds.length) === 1, await score());
  await manual(null, '1'); ok('impossible 1 rejected, save disabled', (await txt('#mRes')).includes('ما يطلع') && await p.isDisabled('#mGo'));
  await p.click('[data-a=clr]'); for (const d of '135') await p.click(`.keys [data-v="${d}"]`);
  ok('over 130 rejected', (await txt('#mRes')).includes('130'));
  await p.click('[data-a=clr]'); for (const d of '130') await p.click(`.keys [data-v="${d}"]`);
  t = await txt('#mRes'); ok('typing 130 = كبوت → 44', t.includes('كبوت') && t.includes('+44'), t);
  await closeSh();

  console.log('Hokm, suits, doubling');
  await p.click('#segMode [data-v=hokm]'); await p.click('#bManual'); await wait(200);
  ok('Hokm without suit: asks for the suit', (await txt('#tMsg')).includes('الحكم') && !(await p.evaluate(() => SK)));
  for (const s of ['S', 'H', 'D', 'C']) { await p.click(`.suit[data-v=${s}]`); ok('suit ' + s + ' selectable', await p.getAttribute(`.suit[data-v=${s}]`, 'aria-pressed') === 'true'); }
  const lv = await p.$$eval('#segLv button', x => x.map(b => b.textContent).join(','));
  ok('Hokm levels: عادي,دبل,ثري,فور,قهوة', lv === 'عادي,دبل,ثري,فور,قهوة', lv);
  const tries = [['double', '+32'], ['three', '+48'], ['four', '+64']];
  for (const [l, want] of tries) {
    await p.click(`#segLv [data-v=${l}]`); await manual('us', '100'); t = await txt('#mRes');
    ok(`${l}: buyer 100 → ${want}, other +0`, t.includes(want) && t.includes('+0'), t); await closeSh();
  }
  await p.click('#segLv [data-v=double]');
  await p.click('#bProj'); await wait(380);
  await p.click('.ptile[data-v=fifty]'); await p.click('#segPT [data-v=them]'); await p.click('.ptile[data-v=baloot]');
  ok('second بلوت blocked', await p.isDisabled('.ptile[data-v=baloot]') === true || (await p.$$('.pchip')).length === 2);
  await p.click('#segPT [data-v=us]'); ok('بلوت tile disabled for us too (only one exists)', await p.isDisabled('.ptile[data-v=baloot]'));
  ok('project totals: لنا 5 · لهم 2', (await txt('#pTot')).replace(/\s/g, '').includes('لنا5') && (await txt('#pTot')).replace(/\s/g, '').includes('لهم2'), await txt('#pTot'));
  await p.click('.go[data-a=close]'); await wait(380);
  await manual('us', '100'); t = await txt('#mRes');
  ok('دبل + خمسين ×2 → us +42, بلوت them +2', t.includes('+42') && t.includes('+2'), t);
  await p.click('#mGo'); await wait(600);
  ok('saved: 56–14', await score() === '56-14', await score());
  ok('after saving: projects cleared, doubling back to عادي, Hokm ♣ kept', await p.evaluate(() => S.cur.projects.length === 0 && S.cur.level === 'normal' && S.cur.mode === 'hokm' && S.cur.trump === 'C'));

  console.log('Sun doubling only when allowed');
  await p.click('#segMode [data-v=sun]');
  ok('us 56: still no Sun double', !(await p.$('#segLv')));
  await p.evaluate(() => { S.rounds.push({ mode: 'sun', buyer: 'us', level: 'normal', us: 50, them: 0, made: true, projects: [], at: 1 }); save(); renderHome(); });
  const sl = await p.$$eval('#segLv button', x => x.map(b => b.textContent).join(','));
  ok('us 106 / them 14, buyer لنا → عادي,دبل only', sl === 'عادي,دبل', sl);
  await p.click('#segBuyer [data-v=them]'); ok('buyer لهم (behind) → no double', !(await p.$('#segLv')));
  await p.click('#segBuyer [data-v=us]');
  await p.click('#segLv [data-v=double]'); await manual('us', '60'); t = await txt('#mRes');
  ok('Sun دبل, buyer 60–70 loses → them +52', t.includes('خسر') && t.includes('+52'), t); await closeSh();
  await p.click('#segLv [data-v=normal]');

  console.log('scan');
  await p.click('#segMode [data-v=hokm]'); await p.click('.suit[data-v=H]');
  await p.click('#bProj'); await wait(350); await p.click('.ptile[data-v=baloot]'); await p.click('.go[data-a=close]'); await wait(350);
  await p.click('#bScan'); await wait(380);
  ok('scan opens a sheet with camera + photos options', await p.isVisible('[data-a=pickCam]') && await p.isVisible('[data-a=pickLib]'));
  ok('camera input uses the back camera; library input takes JPG/PNG/HEIC',
    await p.getAttribute('#photoCam', 'capture') === 'environment' && /heic/.test(await p.getAttribute('#photoLib', 'accept')) && await p.getAttribute('#photoLib', 'capture') === null);
  // library: a non-image file is refused and nothing is sent to the AI
  await p.evaluate(() => { window.__calls = 0; const f = AIF.json; AIF.json = async (...a) => { window.__calls++; return f(...a); }; });
  let [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickLib]')]);
  await fc.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }); await wait(400);
  ok('non-image file: clear error, AI not called', (await txt('#sb')).includes('مو صورة') && await p.evaluate(() => window.__calls) === 0);
  await p.click('[data-a=addPhoto]'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickLib]')]);
  await fc.setFiles({ name: 'cards.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  ok('library photo: preview shown and sent to the same recognition pipeline (overview + zoom crops = 2 calls)', await p.isVisible('.pv img') && await p.evaluate(() => window.__calls) === 2);
  t = await txt('#pStat'); ok('8 cards from the reply (a card read twice is counted once)', t.includes('8'), t);
  ok('no photo-type buttons: the scan is our team\'s cards', !(await p.$('#segKind')) && !(await p.$('[data-a=pKind]')) && (await txt('.sh-h h2')).includes('أكلاتنا'));
  ok('asks the two things a photo cannot show: last trick, and whether these are ALL our tricks', await p.isVisible('#segLast') && await p.isVisible('#segAll') && await p.isDisabled('#pGo'));
  await p.click('#segAll [data-v="1"]');
  ok('still asks who took الأرض', (await txt('#pGo')).includes('الأرض') && await p.isDisabled('#pGo'));
  await p.click('#segLast [data-v=us]'); t = await txt('#pRes');
  ok('our pile 66 + بلوت 20 = 86 < 96 → buyer loses: us +2, them +16', t.includes('خسر') && t.includes('+2') && t.includes('+16'), t);
  ok('"how it was scored" shows the same numbers', t.includes('كيف انحسبت') && t.includes('66') && t.includes('96') && t.includes('كل نقاط الجولة 16'), t);
  await p.click('#segAll [data-v="0"]');
  ok('"فيه ناقص": shows our abnat so far (66) and does NOT give the rest to them', (await txt('#pRes')).includes('66') && !(await p.$('#pRes .result')) && await p.isDisabled('#pGo'));
  await p.click('#segAll [data-v="1"]');
  await openGrid(); await p.click('.cd[data-v=QH]'); ok('7 cards: warns about whole tricks', (await txt('#pRes')).includes('4'));
  await p.click('.cd[data-v=QH]');
  // replace the photo: its cards are removed, then the new photo's cards come in
  await p.evaluate(() => { window.__cards = [['J', 'H'], ['9', 'H'], ['7', 'H'], ['8', 'H']]; });
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=retake]')]);
  await fc.setFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  ok('replaced photo: its cards swapped for the new 4 (Q♥ kept: tapped in by hand)', (await p.evaluate(() => [...P.cards].sort().join(','))) === '7H,8H,9H,JH,QH' && (await p.$$('.pv')).length === 1);
  // add a camera photo, then delete it again
  await p.evaluate(() => { window.__cards = [['A', 'S'], ['10', 'S'], ['K', 'S'], ['Q', 'S']]; });
  await p.click('[data-a=addPhoto]'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickCam]')]);
  await fc.setFiles({ name: 'c.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  ok('second (camera) photo adds its 4 cards, 2 thumbnails', await p.evaluate(() => P.cards.size) === 9 && (await p.$$('.pthumbs button')).length === 2);
  await p.click('[data-a=delPhoto]'); await wait(200);
  ok('deleting that photo removes only its cards', await p.evaluate(() => P.cards.size) === 5);
  // back to the original 8 cards for the score check
  await p.evaluate(() => { window.__cards = [['A', 'S'], ['10', 'S'], ['K', 'S'], ['Q', 'S'], ['A', 'H'], ['10', 'H'], ['K', 'H'], ['Q', 'H']]; });
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=retake]')]);
  await fc.setFiles({ name: 'd.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  await p.click('#segLast [data-v=us]'); await p.click('#segAll [data-v="1"]');
  await p.click('.cd[data-v="7D"]'); const added7 = await p.evaluate(() => P.cards.has('7D'));
  await p.click('.cd[data-v="7D"]'); const removed7 = !(await p.evaluate(() => P.cards.has('7D')));
  ok('recognition can be corrected by tapping cards', added7 && removed7);
  await p.click('#pGo'); await wait(600);
  ok('scan saved: 108–30', await score() === '108-30', await score());

  console.log('uncertain cards: shown on the photo, fixed with one tap');
  await p.evaluate(() => { window.__cards = [['K', 'S'], ['Q', 'H'], ['7', 'C'], ['8', 'D']]; window.__conf = { QH: 0.55 }; window.__alts = { QH: [{ rank: 'Q', suit: 'D' }] }; });
  await p.click('#bScan'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickCam]')]);
  await fc.setFiles({ name: 'u.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  ok('every recognised card is boxed on the photo (4 boxes)', (await p.$$('.pvin .bx')).length === 4);
  ok('the unsure card is marked and opened for checking, with its zoom and the AI\'s best guess', (await p.$$('.bx.s-check')).length === 1 && await p.isVisible('.fix img') && (await txt('.fix')).includes('Q♥'));
  ok('no score while a card still needs checking', !(await p.$('#pRes .result')) && await p.isDisabled('#pGo') && (await txt('#pGo')).includes('أكّد'));
  await p.click('.fixopts [data-v=QD]');
  ok('one tap on the alternative (Q♦) fixes it; the card list updates', await p.evaluate(() => P.cards.has('QD') && !P.cards.has('QH')) && (await p.$$('.bx.s-check')).length === 0);
  ok('then the round can be scored (asks for the remaining questions next)', !(await txt('#pGo')).includes('أكّد'));
  await p.click('.bx >> nth=0'); await wait(150);
  await p.click('[data-a=fxRank][data-v=A]'); await p.click('[data-a=fxSuit][data-v=C]'); await p.click('.fixacts .go');
  ok('big rank + suit buttons then تأكيد change any card', await p.evaluate(() => P.cards.has('AC')));
  await p.click('.bx >> nth=1'); await wait(150); await p.click('[data-a=detRemove]');
  ok('"مو ورقة": the box is ignored and the card leaves the list', await p.evaluate(() => P.cards.size) === 3 && (await p.$$('.pvin .bx')).length === 3);
  await openGrid(); await p.click('.cd[data-v="9C"]');
  ok('a missing card is added from the grid without re-scanning', await p.evaluate(() => P.cards.has('9C') && P.cards.size === 4));
  await closeSh();
  await p.evaluate(() => { window.__conf = null; window.__alts = null; });

  console.log('regressions: one count everywhere, duplicate A♣, re-check keeps confirmations');
  // pass A reads A♣ at one place, the zoom pass reads A♣ with a drifted box, plus 3 other cards → 4 physical cards
  await p.evaluate(() => {
    window.__passA = () => ({ cards: [{ box: [50, 100, 150, 400], rank: 'A', suit: 'C', conf: 0.9 }, { box: [300, 100, 400, 400], rank: 'K', suit: 'D', conf: 0.95 }, { box: [500, 100, 600, 400], rank: '7', suit: 'S', conf: 0.95 }, { box: [700, 100, 800, 400], rank: '9', suit: 'H', conf: 0.95 }] });
    window.__passB = () => ({ crops: [{ i: 1, cards: [{ box: [500, 600, 700, 900], rank: 'A', suit: 'C', conf: 0.9 }] }] });
  });
  await p.click('#bScan'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickCam]')]);
  await fc.setFiles({ name: 'r1.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  const counts = async () => ({ ov: (await txt('.ov')).match(/\d+/)[0], list: (await txt('.clh b')).match(/\d+/)[0], stat: (await txt('#pStat')).match(/\d+/)[0], boxes: (await p.$$('.pvin .bx')).length });
  let cn = await counts();
  ok('drifted duplicate of A♣ is one card: photo, list and status all say 4', cn.ov === '4' && cn.list === '4' && cn.stat === '4' && cn.boxes === 4, cn);
  ok('no conflict shown for it', (await p.$$('.ch.conf')).length === 0);
  ok('missing info is listed clearly', (await txt('#pRes')).includes('الأرض') && (await txt('#pRes')).includes('كل أكلاتنا'));
  await closeSh();
  // the same answer lists A♣ twice → real conflict: both flagged, nothing renamed, nothing added
  await p.evaluate(() => {
    window.__passA = () => ({ cards: [{ box: [50, 100, 150, 400], rank: 'A', suit: 'C', conf: 0.9 }, { box: [700, 500, 800, 900], rank: 'A', suit: 'C', conf: 0.6, alts: [{ rank: 'A', suit: 'S' }] }, { box: [300, 100, 400, 400], rank: 'K', suit: 'D', conf: 0.95 }] });
    window.__passB = null; window.__recheck = () => ({ cards: [] });
  });
  await p.click('#bScan'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickCam]')]);
  await fc.setFiles({ name: 'r2.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  cn = await counts();
  ok('A♣ in two places: count stays 3 (nothing invented), both A♣ marked red, K♦ not marked', cn.list === '3' && cn.boxes === 3 && (await p.$$('.ch.conf')).length === 2 && (await p.$$('.bx.s-conf')).length === 2 && (await p.$$('.ch.att')).length === 0, cn);
  ok('identities were not silently replaced (both still read A♣)', await p.evaluate(() => P.photos[0].dets.filter(d => d.rank + d.suit === 'AC').length === 2));
  ok('the panel compares the two places side by side', (await p.$$('.cmp img')).length === 2);
  const otherId = await p.evaluate(() => P.photos[0].dets.find(d => d.rank + d.suit === 'AC' && d.id !== P.sel.id).id);
  const selId = await p.evaluate(() => P.sel.id);
  await p.click(`[data-a=keepAs][data-v="${selId}"]`); await wait(100);
  ok('choose which one is A♣ → the other now asks for its real identity', await p.evaluate(id => { const d = P.photos[0].dets.find(x => x.id === id); return d.rank === null && d.status === 'check' && P.sel && P.sel.id === id; }, otherId));
  await p.click('.fixopts [data-v=AS]');
  ok('one tap on the suggestion (A♠) resolves it; still 3 cards, none flagged', (await counts()).list === '3' && (await p.$$('.ch.att, .ch.conf')).length === 0);
  // re-check never changes what the user confirmed, and never changes the count
  await p.evaluate(() => { const d = P.photos[0].dets.find(x => x.rank === 'K'); d.status = 'check'; d.conf = 0.5; window.__recheck = () => ({ cards: [{ i: 1, card: true, rank: 'Q', suit: 'D', conf: 0.95 }] }); pileSheet(); });
  await p.click('[data-a=recheck]'); await wait(700);
  ok('re-check: only the unconfirmed card is re-read (K♦ → Q♦, shown as corrected); confirmed A♣/A♠ untouched; count 3',
    await p.evaluate(() => { const ds = P.photos[0].dets; return ds.some(d => d.rank + d.suit === 'QD' && d.reread && d.prev === 'KD') && ds.some(d => d.rank + d.suit === 'AC' && d.user) && ds.some(d => d.rank + d.suit === 'AS' && d.user); }) && (await counts()).list === '3');
  const before = await counts(); await closeSh(); await p.evaluate(() => { SK = null; pileSheet(); }); await wait(300);
  ok('closing and reopening the sheet does not change any count', JSON.stringify(await counts()) === JSON.stringify(before));
  await closeSh();
  await p.evaluate(() => { window.__passA = null; window.__passB = null; window.__recheck = null; });

  console.log('confirmation bug: 6 unsure cards, confirm each once');
  await p.evaluate(() => {
    const L = [['A', 'S'], ['10', 'H'], ['K', 'D'], ['9', 'C'], ['Q', 'S'], ['7', 'H'], ['8', 'D'], ['J', 'C']];
    window.__passA = () => ({ cards: L.map(([r, su], i) => ({ box: [20 + i * 120, 100, 120 + i * 120, 450], rank: r, suit: su, conf: i < 6 ? 0.5 : 0.95 })) });
    window.__passB = null; window.__recheck = () => ({ cards: [] });
  });
  await p.click('#bScan'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickCam]')]);
  await fc.setFiles({ name: 'c6.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  const pend = () => p.evaluate(() => pending().length);
  ok('8 cards, 6 need confirmation, the first is open', await pend() === 6 && await p.isVisible('.fixacts .go'));
  const seen = [];
  for (let k = 6; k >= 1; k--) {
    const id = await p.evaluate(() => P.sel && P.sel.id); seen.push(id);
    await p.click('.fixacts .go'); await wait(80);
    const left = await pend();
    if (left !== k - 1) { ok(`تأكيد #${7 - k} lowers the count by exactly one`, false, { left, want: k - 1 }); break; }
  }
  ok('each تأكيد lowered the count by one: 6 → 0, each card opened once, then advanced', await pend() === 0 && new Set(seen).size === 6);
  ok('success feedback shown', (await txt('#tMsg')).includes('كل الأوراق مؤكدة'));
  ok('confirmed cards stay confirmed (never reopened)', await p.evaluate(() => P.photos[0].dets.filter(d => d.user).length) === 6 && await p.evaluate(() => P.sel) === null);
  await p.click('#segLast [data-v=us]'); await p.click('#segAll [data-v="1"]');
  ok('with everything answered, the round can be saved', !(await p.isDisabled('#pGo')) && !!(await p.$('#pRes .result')));
  // a card cannot be confirmed as a card already confirmed elsewhere in the photo
  await p.evaluate(() => { const d = P.photos[0].dets[7]; d.status = 'check'; P.sel = { ph: P.photos[0].id, id: d.id }; pileSheet(); });
  await p.click('[data-a=fxRank][data-v=A]'); await p.click('[data-a=fxSuit][data-v=S]'); await p.click('.fixacts .go'); await wait(80);
  ok('confirming a second A♠ is refused with a message (one of each card); nothing changes', (await txt('#tMsg')).includes('مؤكدة لورقة ثانية') && await p.evaluate(() => P.photos[0].dets[7].rank + P.photos[0].dets[7].suit) === 'JC' && await pend() === 1);
  await p.click('[data-a=fxRank][data-v=J]'); await p.click('[data-a=fxSuit][data-v=C]'); await p.click('.fixacts .go'); await wait(80);
  ok('confirming its real identity clears it', await pend() === 0);
  // a conflict that goes away releases the other card
  await p.evaluate(() => { const ds = P.photos[0].dets; ds[6].rank = 'J'; ds[6].suit = 'C'; ds[6].user = false; ds[7].user = false; ds[6].status = 'ok'; ds[7].status = 'ok'; conflictsIn(P.photos[0].id); rebuild(); pileSheet(); });
  ok('two unconfirmed J♣ → both flagged', await pend() === 2);
  await p.evaluate(() => { P.sel = { ph: P.photos[0].id, id: P.photos[0].dets[6].id }; pileSheet(); });
  await p.click('[data-a=detRemove]'); await wait(80);
  ok('removing one releases the other (count of pending back to 0)', await pend() === 0, await pend());
  await closeSh();
  await p.evaluate(() => { window.__passA = null; window.__passB = null; window.__recheck = null; });

  console.log('history, edit, undo, refresh');
  await p.reload(); await wait(500);
  ok('match restored after refresh', await score() === '108-30');
  await p.click('#bHist'); await wait(350); ok('4 rounds listed', (await p.$$('.hl .hr')).length === 4);
  await p.click('[data-a=edit][data-v="0"]'); await wait(900);
  ok('editing round 1 opens the keypad with its abnat', (await txt('#mBig')) === '70' && (await txt('#editBar')).includes('1'));
  await p.click('[data-a=clr]'); for (const d of '90') await p.click(`.keys [data-v="${d}"]`);
  await p.click('#mGo'); await wait(600);
  ok('round 1 replaced in place (Sun 90 → 18/8): 112–26', await score() === '112-26' && await p.evaluate(() => S.rounds.length === 4 && S.rounds[0].us === 18), await score());
  ok('round card back to the setup before editing', await p.evaluate(() => S.cur.mode === 'hokm' && S.cur.trump === 'H' && !S.edit));
  await p.click('#tAct'); await wait(500); ok('undo edit restores round 1', await score() === '108-30');
  await p.click('#bHist'); await wait(350); await p.click('[data-a=del][data-v="3"]'); await wait(500);
  ok('delete last round', await score() === '106-14');
  await p.click('#tAct'); await wait(500); ok('undo delete', await score() === '108-30');
  await closeSh();

  console.log('gahwa ends the game');
  await p.click('#segLv [data-v=gahwa]'); await manual('us', '100'); t = await txt('#mRes');
  ok('قهوة preview: we win the game', t.includes('القهوة') && t.includes('+44'), t);
  await p.click('#mGo'); await wait(700);
  ok('game over screen, round card hidden', (await txt('#wonBox')).includes('الصكة لنا') && await p.isHidden('#roundCard'));
  await p.click('[data-a=newGameNow]'); await wait(500);
  ok('new game: 0–0, previous game kept in the record', await score() === '0-0' && await p.evaluate(() => S.games.length === 1));

  console.log('settings, share, voice parser');
  await p.click('#bMore'); await wait(350); await p.click('[data-a=sunDouble][data-v=always]'); await closeSh();
  await p.click('#segMode [data-v=sun]'); ok('setting "Sun double always" shows دبل at 0–0', !!(await p.$('#segLv [data-v=double]')));
  const v = await p.evaluate(() => [parseSpoken('لنا تسعين'), parseSpoken('لهم ٨٢'), parseSpoken('كبوت لهم'), parseSpoken('لنا مية وعشرين')]);
  ok('voice text → numbers', v[0].val === 90 && v[0].team === 'us' && v[1].val === 82 && v[1].team === 'them' && v[2].kaboot && v[2].team === 'them' && v[3].val === 120, v);
  ok('share text lists the score', (await p.evaluate(() => shareText())).startsWith('بلوت — لنا 0'));
  ok('no page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();

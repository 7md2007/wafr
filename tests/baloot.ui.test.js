// Baloot page tests (Playwright, iPhone-size) — run: node tests/baloot.ui.test.js
// AI card reading is replaced by a stub that answers like the real model (cards with boxes): this checks the app's
// handling of a reply, not real recognition. The browser's fake camera is used for the in-app camera.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../baloot/index.html');
let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, i !== undefined ? JSON.stringify(i) : '') } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, permissions: ['camera'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    window.__cards = [['A', 'S'], ['10', 'S'], ['K', 'S'], ['Q', 'S'], ['A', 'H'], ['10', 'H'], ['K', 'H'], ['Q', 'H'], ['A', 'S']];
    const boxOf = (k, keys) => { const i = keys.indexOf(k); return [40 + (i % 8) * 120, 100 + Math.floor(i / 8) * 400, 140 + (i % 8) * 120, 450 + Math.floor(i / 8) * 400]; };
    const ai = {
      limits: async () => ({ images: { maxCount: 8 } }),
      json: async prompt => {
        window.__calls = (window.__calls || 0) + 1;
        const keys = window.__cards.map(([r, s]) => r + s);
        if (/turquoise frame/.test(prompt)) return window.__recheck ? window.__recheck() : { cards: [] };
        if (/zoomed crop/.test(prompt)) return window.__passB ? window.__passB() : { crops: [] };
        if (window.__passA) return window.__passA();
        return { cards: window.__cards.map(([rank, suit]) => ({ box: boxOf(rank + suit, keys), rank, suit, conf: (window.__conf && window.__conf[rank + suit]) || 0.95, alts: (window.__alts && window.__alts[rank + suit]) || [] })) };
      } };
    // the in-page camera is used here (a real browser page); inside Claude the phone camera is used instead
    window.__claude = { use: async n => n === 'sample' ? Object.assign(async () => ({ text: '' }), ai) : null };
    Object.defineProperty(window, 'claude', { get() { return sessionStorage.getItem('liveCam') ? undefined : window.__claude; }, configurable: true });
  });
  await p.goto(URL); await p.waitForTimeout(400);
  const txt = s => p.textContent(s);
  const score = async () => [await txt('#sUs'), await txt('#sThem')].join('-');
  const wait = ms => p.waitForTimeout(ms);
  const closeSh = async () => { await p.click('.sh-x[data-a=close]'); await wait(380); };
  const manual = async (team, digits) => { await p.click('#bManual'); await wait(380); if (team) await p.click(`#segTeam [data-v=${team}]`); for (const d of digits) await p.click(`.keys [data-v="${d}"]`); };
  const setLevel = async l => { await p.click('#bLevel'); await wait(380); await p.click(`#segLv [data-v=${l}]`); await closeSh(); };
  const fromLib = async name => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bLib')]); await fc.setFiles({ name: name || 'x.png', mimeType: 'image/png', buffer: PNG }); await wait(900); };
  const pend = () => p.evaluate(() => pending().length);
  const listN = async () => +((await txt('.clh b')).match(/\d+/) || [0])[0];

  console.log('home');
  ok('Sun by default, buyer لنا, suits hidden', await p.getAttribute('#segMode [data-v=sun]', 'aria-pressed') === 'true' && (await p.getAttribute('#suits', 'class')).includes('off') && await p.getAttribute('#segBuyer [data-v=us]', 'aria-pressed') === 'true');
  ok('home shows only: scores, mode, buyer, compact extras, Scan, manual, from photos', await p.isVisible('#sUs') && await p.isVisible('#bScan') && await p.isVisible('#bManual') && await p.isVisible('#bLib') && !(await p.$('#lvBox')) && !(await p.$('.projrow')));
  ok('Sun at 0–0: doubling chip says no doubling and is off', await p.isDisabled('#bLevel') && (await txt('#bLevel')).includes('بدون'));
  ok('undo hidden while there is nothing to undo', await p.isHidden('#bUndo'));
  ok('no horizontal scroll at 390 px', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  console.log('manual entry');
  await p.click('#bManual'); await wait(380);
  const order = await p.$$eval('.keys button', x => x.map(b => b.textContent.trim()).join(' '));
  ok('keypad order 1 2 3 / 4 5 6 / 7 8 9 / مسح 0 ⌫', order === '1 2 3 4 5 6 7 8 9 مسح 0 ⌫', order);
  for (const d of '1234567890') await p.click(`.keys [data-v="${d}"]`);
  ok('digits type in order, max 3', (await txt('#mBig')) === '123');
  await p.click('[data-a=back]'); ok('⌫ removes the last digit', (await txt('#mBig')) === '12');
  await p.click('[data-a=clr]'); await p.click('.keys [data-v="0"]'); await p.click('.keys [data-v="5"]');
  ok('مسح clears; a leading 0 is dropped', (await txt('#mBig')) === '5');
  await closeSh();
  await manual('us', '70');
  let t = await txt('#mRes'); ok('Sun 70 → +14 / +12', t.includes('+14') && t.includes('+12'), t);
  await p.click('#mGo'); await p.click('#mGo').catch(() => {}); await wait(600);
  ok('saved once (double tap ignored)', await score() === '14-12' && await p.evaluate(() => S.rounds.length) === 1, await score());
  ok('undo button appears on home', await p.isVisible('#bUndo'));
  await manual(null, '1'); ok('impossible 1 rejected, save disabled', (await txt('#mRes')).includes('ما يطلع') && await p.isDisabled('#mGo'));
  await p.click('[data-a=clr]'); for (const d of '130') await p.click(`.keys [data-v="${d}"]`);
  t = await txt('#mRes'); ok('typing 130 = كبوت → 44', t.includes('كبوت') && t.includes('+44'), t);
  await closeSh();

  console.log('Hokm, suits, doubling, projects');
  await p.click('#segMode [data-v=hokm]'); await p.click('#bManual'); await wait(200);
  ok('Hokm without suit: asks for the suit', (await txt('#tMsg')).includes('الحكم') && !(await p.evaluate(() => SK)));
  for (const s of ['S', 'H', 'D', 'C']) { await p.click(`.suit[data-v=${s}]`); ok('suit ' + s + ' selectable', await p.getAttribute(`.suit[data-v=${s}]`, 'aria-pressed') === 'true'); }
  await p.click('#bLevel'); await wait(380);
  const lv = await p.$$eval('#segLv button', x => x.map(b => b.textContent).join(','));
  ok('doubling chip opens a small sheet: عادي,دبل,ثري,فور,قهوة', lv === 'عادي,دبل,ثري,فور,قهوة', lv);
  await closeSh();
  for (const [l, want] of [['double', '+32'], ['three', '+48'], ['four', '+64']]) {
    await setLevel(l); await manual('us', '100'); t = await txt('#mRes');
    ok(`${l}: buyer 100 → ${want}, other +0; chip shows it`, t.includes(want) && t.includes('+0') && (await txt('#bLevel')).length > 0, t); await closeSh();
  }
  await setLevel('double');
  await p.click('#bProj'); await wait(380);
  await p.click('.ptile[data-v=fifty]'); await p.click('#segPT [data-v=them]'); await p.click('.ptile[data-v=baloot]');
  await p.click('#segPT [data-v=us]'); ok('only one بلوت possible', await p.isDisabled('.ptile[data-v=baloot]'));
  await p.click('.go[data-a=close]'); await wait(380);
  ok('projects chip lists them', (await txt('#bProj')).includes('خمسين') && (await txt('#bProj')).includes('بلوت'));
  await manual('us', '100'); t = await txt('#mRes');
  ok('دبل + خمسين ×2 → us +42, بلوت them +2', t.includes('+42') && t.includes('+2'), t);
  await p.click('#mGo'); await wait(600);
  ok('saved: 56–14', await score() === '56-14', await score());
  ok('after saving: projects cleared, doubling back to عادي, Hokm ♣ and buyer kept', await p.evaluate(() => S.cur.projects.length === 0 && S.cur.level === 'normal' && S.cur.mode === 'hokm' && S.cur.trump === 'C' && S.cur.buyer === 'us'));

  console.log('Sun doubling only when allowed');
  await p.click('#segMode [data-v=sun]');
  ok('us 56: still no Sun double', await p.isDisabled('#bLevel'));
  await p.evaluate(() => { S.rounds.push({ mode: 'sun', buyer: 'us', level: 'normal', us: 50, them: 0, made: true, projects: [], at: 1 }); save(); renderHome(); });
  await p.click('#bLevel'); await wait(380);
  ok('us 106 / them 14, buyer لنا → عادي,دبل only', (await p.$$eval('#segLv button', x => x.map(b => b.textContent).join(','))) === 'عادي,دبل');
  await closeSh();
  await p.click('#segBuyer [data-v=them]'); ok('buyer لهم (behind) → no double', await p.isDisabled('#bLevel'));
  await p.click('#segBuyer [data-v=us]');
  await setLevel('double'); await manual('us', '60'); t = await txt('#mRes');
  ok('Sun دبل, buyer 60–70 loses → them +52', t.includes('خسر') && t.includes('+52'), t); await closeSh();
  await setLevel('normal');

  console.log('scan: from photos');
  await p.click('#segMode [data-v=hokm]'); await p.click('.suit[data-v=H]');
  await p.click('#bProj'); await wait(350); await p.click('.ptile[data-v=baloot]'); await p.click('.go[data-a=close]'); await wait(350);
  window_calls0 = await p.evaluate(() => (window.__calls = 0));
  const [fcBad] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bLib')]);
  await fcBad.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }); await wait(400);
  ok('non-image file: friendly error, AI not called', (await txt('#sb')).includes('مو صورة') && await p.evaluate(() => window.__calls) === 0);
  await closeSh();
  await fromLib('cards.png');
  ok('the sheet opens straight on the result: no photo-type buttons, no 32-card grid', !(await p.$('#segKind')) && !(await p.$('.grid')) && !(await p.$('#segAll')) && (await txt('.sh-h h2')).includes('أكلاتنا'));
  ok('8 cards as chips (A♠ read twice = one card)', await listN() === 8, await listN());
  ok('two AI calls for a clear photo', await p.evaluate(() => window.__calls) === 2);
  t = await txt('#pRes');
  ok('ONE question with the score on each answer', t.includes('هذي كل أكلاتنا') && (await p.$$('[data-a=pDone]')).length === 2 && !!(await p.$('[data-a=pPartial]')));
  // our pile 56 (+10 if last trick ours = 66) + بلوت 20 = 86 < 96 → buyer loses: us +2 (بلوت), them +16
  const ansUs = await txt('[data-a=pDone][data-v=us]'), ansThem = await txt('[data-a=pDone][data-v=them]');
  ok('"كلها، والأرض لنا" shows +2 / +16 (buyer loses)', ansUs.includes('+2') && ansUs.includes('+16') && ansUs.includes('خسر'), ansUs);
  ok('"كلها، والأرض لهم" shows its own result', ansThem.includes('+'), ansThem);
  await p.click('[data-a=pPartial]');
  ok('"فيه ناقص": our abnat only (56), nothing given to them, no save', (await txt('#pRes')).includes('56') && !(await p.$('[data-a=pDone]')));
  await p.click('[data-a=pUndoPartial]');
  // add a missing card without a grid, then remove it
  await p.click('[data-a=addCard]'); await p.click('[data-a=addRank][data-v="7"]'); await p.click('[data-a=addSuit][data-v=D]');
  ok('"+ ورقة": rank then suit adds a missing card (9 cards)', await listN() === 9 && await p.evaluate(() => P.cards.has('7D')));
  ok('9 cards is not whole tricks: a gentle note, answers still shown', (await txt('#pRes')).includes('4 أوراق'));
  await p.click('.ch.man'); ok('tap the added chip to remove it', await listN() === 8);
  await p.click('[data-a=addClose]').catch(() => {});
  await p.click('[data-a=pDone][data-v=us]'); await wait(600);
  ok('one tap on the answer saves the round with undo offered', await score() === '108-30' && (await txt('#tMsg')).includes('سجلنا') && await p.isVisible('#tAct'), await score());

  console.log('scan: live camera, one tap to shoot (own-key AI path, API reply faked)');
  const LIVE = [['J', 'H'], ['9', 'H'], ['A', 'H'], ['10', 'H'], ['A', 'S'], ['10', 'S'], ['K', 'S'], ['Q', 'S']];
  await p.route('https://api.anthropic.com/**', async route => {
    const body = route.request().postData() || '';
    const ans = /zoomed crop/.test(body) ? { crops: [] } : /turquoise frame/.test(body) ? { cards: [] } : { cards: LIVE.map(([rank, suit], i) => ({ box: [20 + i * 120, 100, 120 + i * 120, 450], rank, suit, conf: 0.95 })) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(ans) }] }) });
  });
  await p.evaluate(() => { sessionStorage.setItem('liveCam', '1'); localStorage.setItem('wafr.aikey', 'sk-ant-test'); });
  await p.reload(); await wait(600);
  let taps = 0; const tap = async sel => { taps++; await p.click(sel); };
  const before0 = await score();
  await tap('#bScan'); await wait(1200);
  ok('tap 1 — Scan opens the in-app camera at once (live preview)', await p.isVisible('#cam') && await p.evaluate(() => document.querySelector('#camV').videoWidth > 0));
  await tap('#camShot'); await wait(1500);
  ok('tap 2 — shutter: camera closes, the result sheet shows the 8 cards', await p.isHidden('#cam') && await listN() === 8 && await p.evaluate(() => !document.querySelector('#camV').srcObject));
  ok('the score is on the answer buttons', (await txt('[data-a=pDone][data-v=us]')).includes('+'));
  await tap('[data-a=pDone][data-v=us]'); await wait(600);
  ok(`tap 3 — answer saves the round: ${taps} taps in total (Scan → shutter → answer)`, taps === 3 && (await score()) !== before0, [before0, await score()]);
  await p.click('#bUndo'); await wait(400);
  ok('home undo takes that round back', (await score()) === before0);
  await p.click('#bScan'); await wait(900); await p.click('#camX'); await wait(200);
  ok('closing the camera stops it', await p.isHidden('#cam') && await p.evaluate(() => !document.querySelector('#camV').srcObject));
  await p.unroute('https://api.anthropic.com/**');
  await p.evaluate(() => { sessionStorage.clear(); localStorage.setItem('wafr.aikey', ''); });
  await p.reload(); await wait(500);

  console.log('uncertain cards: tap, fix, confirm');
  await p.evaluate(() => { window.__cards = [['K', 'S'], ['Q', 'H'], ['7', 'C'], ['8', 'D']]; window.__conf = { QH: 0.55 }; window.__alts = { QH: [{ rank: 'Q', suit: 'D' }] }; });
  await fromLib('u.png');
  ok('only the unsure card is highlighted; its editor opens with a zoom', (await p.$$('.ch.att')).length === 1 && await p.isVisible('.fix img'));
  ok('no answers while a card needs a look', !(await p.$('[data-a=pDone]')) && (await txt('#pRes')).includes('نتأكد'));
  await p.click('.fixopts [data-v=QD]');
  ok('one tap on the suggestion (Q♦) fixes it', await p.evaluate(() => P.cards.has('QD') && !P.cards.has('QH')) && (await p.$$('.ch.att')).length === 0 && !!(await p.$('[data-a=pDone]')));
  await p.click('.ch >> nth=0'); await wait(100);
  await p.click('[data-a=fxRank][data-v=A]'); await p.click('[data-a=fxSuit][data-v=C]'); await p.click('.fixacts .go');
  ok('rank + suit + تأكيد change any card', await p.evaluate(() => P.cards.has('AC')));
  await p.click('.ch >> nth=1'); await wait(100); await p.click('[data-a=detRemove]');
  ok('"مو ورقة": card leaves the list, can be restored', await listN() === 3 && (await txt('.rem')).includes('↺'));
  await p.click('.rem button'); ok('restore brings it back', await listN() === 4);
  await p.click('[data-a=viewPhoto][data-v="0"]');
  ok('tap the photo thumbnail to see it with outlines (hidden by default)', (await p.$$('.pvin .bx')).length === 4);
  await closeSh();
  await p.evaluate(() => { window.__conf = null; window.__alts = null; });

  console.log('confirmation: 6 unsure cards, confirm each once');
  await p.evaluate(() => {
    const L = [['A', 'S'], ['10', 'H'], ['K', 'D'], ['9', 'C'], ['Q', 'S'], ['7', 'H'], ['8', 'D'], ['J', 'C']];
    window.__passA = () => ({ cards: L.map(([r, su], i) => ({ box: [20 + i * 120, 100, 120 + i * 120, 450], rank: r, suit: su, conf: i < 6 ? 0.5 : 0.95 })) });
    window.__passB = null; window.__recheck = () => ({ cards: [] });
  });
  await fromLib('c6.png');
  ok('8 cards, 6 need a look, the first is open', await pend() === 6 && await p.isVisible('.fixacts .go'));
  const seen = [];
  for (let k = 6; k >= 1; k--) {
    seen.push(await p.evaluate(() => P.sel && P.sel.id));
    await p.click('.fixacts .go'); await wait(60);
    if (await pend() !== k - 1) { ok(`تأكيد #${7 - k} lowers the count by one`, false, await pend()); break; }
  }
  ok('each تأكيد lowered the count by one (6 → 0), each card opened once', await pend() === 0 && new Set(seen).size === 6);
  ok('feedback + answers appear when all are confirmed', (await txt('#tMsg')).includes('كل الأوراق مؤكدة') && !!(await p.$('[data-a=pDone]')));
  await p.evaluate(() => { const d = P.photos[0].dets[7]; d.status = 'check'; P.sel = { ph: P.photos[0].id, id: d.id }; pileSheet(); });
  await p.click('[data-a=fxRank][data-v=A]'); await p.click('[data-a=fxSuit][data-v=S]'); await p.click('.fixacts .go'); await wait(60);
  ok('confirming a second A♠ is refused (one of each card)', (await txt('#tMsg')).includes('مؤكدة لورقة ثانية') && await pend() === 1);
  await p.click('[data-a=fxRank][data-v=J]'); await p.click('[data-a=fxSuit][data-v=C]'); await p.click('.fixacts .go'); await wait(60);
  ok('confirming its real identity clears it', await pend() === 0);
  await closeSh();

  console.log('duplicates and counts');
  await p.evaluate(() => {
    window.__passA = () => ({ cards: [{ box: [50, 100, 150, 400], rank: 'A', suit: 'C', conf: 0.9 }, { box: [700, 500, 800, 900], rank: 'A', suit: 'C', conf: 0.6, alts: [{ rank: 'A', suit: 'S' }] }, { box: [300, 100, 400, 400], rank: 'K', suit: 'D', conf: 0.95 }] });
  });
  await fromLib('dup.png');
  ok('A♣ in two places: 3 cards (nothing invented), both A♣ red, K♦ calm', await listN() === 3 && (await p.$$('.ch.conf')).length === 2 && (await p.$$('.ch.att')).length === 0);
  const selId = await p.evaluate(() => P.sel.id);
  await p.click(`[data-a=keepAs][data-v="${selId}"]`); await wait(80);
  await p.click('.fixopts [data-v=AS]');
  ok('pick which is A♣, one tap for the other (A♠): still 3, none flagged', await listN() === 3 && (await p.$$('.ch.att, .ch.conf')).length === 0);
  await closeSh();
  await p.evaluate(() => { window.__passA = null; window.__passB = null; window.__recheck = null; });

  console.log('history, edit, undo, share, refresh');
  await p.reload(); await wait(500);
  ok('match restored after refresh', await score() === '108-30');
  await p.click('#bHist'); await wait(350); ok('4 rounds listed', (await p.$$('.hl .hr')).length === 4);
  ok('share lives in history', !!(await p.$('[data-a=share]')));
  await p.click('[data-a=edit][data-v="0"]'); await wait(900);
  ok('editing round 1 opens the keypad with its abnat', (await txt('#mBig')) === '70');
  await p.click('[data-a=clr]'); for (const d of '90') await p.click(`.keys [data-v="${d}"]`);
  await p.click('#mGo'); await wait(600);
  ok('round 1 replaced in place (Sun 90 → 18/8)', await score() === '112-26', await score());
  await p.click('#tAct'); await wait(500); ok('undo the edit', await score() === '108-30');
  await p.click('#bUndo'); await wait(500); ok('home undo removes the last round', await score() === '106-14', await score());

  console.log('gahwa ends the game');
  await p.click('#segMode [data-v=hokm]'); await setLevel('gahwa'); await manual('us', '100'); t = await txt('#mRes');
  ok('قهوة preview: we win the game', t.includes('القهوة') && t.includes('+46'), t);
  await p.click('#mGo'); await wait(700);
  ok('game over card', (await txt('#wonBox')).includes('الصكة لنا') && await p.isHidden('#roundCard'));
  await p.click('[data-a=newGameNow]'); await wait(500);
  ok('new game: 0–0, previous kept', await score() === '0-0' && await p.evaluate(() => S.games.length === 1));

  console.log('settings, voice parser, layout');
  await p.click('#bMore'); await wait(350); await p.click('[data-a=sunDouble][data-v=always]'); await closeSh();
  await p.click('#segMode [data-v=sun]'); ok('"Sun double always" enables the chip at 0–0', !(await p.isDisabled('#bLevel')));
  const v = await p.evaluate(() => [parseSpoken('لنا تسعين'), parseSpoken('كبوت لهم')]);
  ok('voice text → numbers', v[0].val === 90 && v[0].team === 'us' && v[1].kaboot && v[1].team === 'them', v);
  for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
    await p.setViewportSize({ width: w, height: h }); await wait(150);
    const lay = await p.evaluate(() => ({ hs: document.documentElement.scrollWidth <= innerWidth, scan: document.querySelector('#bScan').getBoundingClientRect().bottom <= innerHeight + 1, clip: [...document.querySelectorAll('.app button')].filter(x => x.offsetParent && x.scrollWidth > x.clientWidth + 2).map(x => x.textContent.trim()) }));
    ok(`${w}×${h}: no sideways scroll, nothing clipped, Scan visible without scrolling`, lay.hs && lay.scan && !lay.clip.length, lay);
  }
  ok('no page errors', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
let window_calls0;

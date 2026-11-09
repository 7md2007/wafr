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
    window.claude = { use: async n => n === 'sample' ? Object.assign(async () => ({ text: '' }), { limits: async () => ({ images: {} }), json: async () => ({ cards: window.__cards.map(([rank, suit]) => ({ rank, suit })), unreadable: 0 }) }) : null };
  });
  await p.goto(URL); await p.waitForTimeout(300);
  const txt = s => p.textContent(s);
  const score = async () => [await txt('#sUs'), await txt('#sThem')].join('-');
  const wait = ms => p.waitForTimeout(ms);
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
  ok('library photo: preview shown and sent to the same recognition call', await p.isVisible('.pv img') && await p.evaluate(() => window.__calls) === 1);
  t = await txt('#pStat'); ok('8 cards from the reply (duplicate ignored)', t.includes('8'), t);
  ok('no score until you say what the photo shows', (await txt('#pGo')).includes('وش في الصورة') && await p.isDisabled('#pGo') && !(await p.$('#pRes .result')));
  // a HAND photo never becomes a score: it only offers its projects and then asks for the trick result
  await p.click('#segKind [data-v=hand]');
  t = await txt('#pRes');
  ok('hand photo: no score, lists its projects (سرا ♠, سرا ♥, بلوت)', !(await p.$('#pRes .result')) && (t.match(/سرا/g) || []).length === 2 && t.includes('بلوت'), t);
  ok('hand photo: must say who owns each project first', await p.isDisabled('#pGo') && (await txt('#pGo')).includes('صاحب'));
  await p.click('#segKind [data-v=tricks]');
  ok('tricks: no score until the team is chosen (no silent default)', (await txt('#pGo')).includes('أكلات مين') && await p.isDisabled('#pGo'));
  await p.click('#segPile [data-v=us]');
  ok('asks who took الأرض before saving', (await txt('#pGo')).includes('الأرض') && await p.isDisabled('#pGo'));
  await p.click('#segLast [data-v=us]'); t = await txt('#pRes');
  ok('pile 66 + بلوت 20 = 86 < 96 → buyer loses: us +2, them +16', t.includes('خسر') && t.includes('+2') && t.includes('+16'), t);
  ok('"how it was scored" shows the same numbers', t.includes('كيف انحسبت') && t.includes('66') && t.includes('96') && t.includes('كل نقاط الجولة 16'), t);
  await p.click('.cd[data-v=QH]'); ok('7 cards: warns about whole tricks', (await txt('#pRes')).includes('4'));
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
  await p.click('#segLast [data-v=us]');
  await p.click('.cd[data-v="7D"]'); const added7 = await p.evaluate(() => P.cards.has('7D'));
  await p.click('.cd[data-v="7D"]'); const removed7 = !(await p.evaluate(() => P.cards.has('7D')));
  ok('recognition can be corrected by tapping cards', added7 && removed7);
  await p.click('#pGo'); await wait(600);
  ok('scan saved: 108–30', await score() === '108-30', await score());

  console.log('hand photo flow');
  await p.evaluate(() => { window.__cards = [['K', 'H'], ['Q', 'H'], ['J', 'H'], ['7', 'S'], ['8', 'S'], ['9', 'D'], ['8', 'C'], ['A', 'C']]; });
  await p.click('#bScan'); await wait(380);
  [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=pickCam]')]);
  await fc.setFiles({ name: 'hand.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  await p.click('#segKind [data-v=hand]');
  await p.click('#own0 [data-v=us]'); await p.click('#own1 [data-v=us]');
  ok('button adds projects and asks for tricks', (await txt('#pGo')).includes('أدخل نتيجة الأكلات') && !(await p.isDisabled('#pGo')));
  await p.click('#pGo'); await wait(900);
  ok('hand projects added (سرا + بلوت for us) and the keypad asks for the trick result',
    await p.evaluate(() => S.cur.projects.map(x => x.type + x.team).sort().join(',')) === 'balootus,sirasus'.replace('sirasus', 'siraus') && await p.evaluate(() => SK) === 'manual' && (await txt('#mVoice')).includes('أبناط'), await p.evaluate(() => S.cur.projects));
  ok('no round was saved from the hand photo', await score() === '108-30' && await p.evaluate(() => S.rounds.length) === 4);
  await closeSh();
  await p.evaluate(() => { S.cur.projects = []; save(); renderHome(); });

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

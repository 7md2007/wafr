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
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#bScan')]);
  await fc.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG }); await wait(900);
  t = await txt('#pStat'); ok('8 cards from the reply (duplicate ignored)', t.includes('8'), t);
  ok('asks who took الأرض before saving', (await txt('#pGo')).includes('الأرض') && await p.isDisabled('#pGo'));
  await p.click('#segLast [data-v=us]'); t = await txt('#pRes');
  ok('pile 66 + بلوت 20 = 86 < 96 → buyer loses: us +2, them +16', t.includes('خسر') && t.includes('+2') && t.includes('+16'), t);
  await p.click('.cd[data-v=QH]'); ok('7 cards: warns about whole tricks', (await txt('#pRes')).includes('4'));
  await p.click('.cd[data-v=QH]'); await p.click('#pGo'); await wait(600);
  ok('scan saved: 108–30', await score() === '108-30', await score());

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

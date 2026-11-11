// Property tests for the Baloot scoring engine: thousands of random rounds checked against rules that must always hold.
// Seeded, so a failure is repeatable. Run: node tests/baloot.props.test.js
const B = require('../baloot/engine.js');
let pass = 0, fail = 0; const bad = {};
const check = (name, cond, info) => { if (cond) return; bad[name] = bad[name] || { n: 0, ex: info }; bad[name].n++; };
let seed = 20261111; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = a => a[Math.floor(rnd() * a.length)];
const TYPES = { sun: ['sira', 'fifty', 'hundred', 'fourHundred'], hokm: ['sira', 'fifty', 'hundred', 'baloot'] };
const flip = t => (t === 'us' ? 'them' : 'us');
const N = 30000; let scored = 0;
for (let i = 0; i < N; i++) {
  const mode = pick(['sun', 'hokm']), M = B.MODE[mode];
  const levels = mode === 'sun' ? ['normal', 'normal', 'double'] : ['normal', 'normal', 'double', 'triple', 'four'];
  const possible = [...B.possibleAbnat(mode)].filter(x => x < M.total);
  const r = { mode, trump: mode === 'hokm' ? pick(B.SUITS) : undefined, buyer: pick(['us', 'them']), level: pick(levels), kaboot: rnd() < 0.06 ? pick(['us', 'them']) : null,
    abnatUs: pick(possible), tieRule: pick(['split', 'buyerLoses']), projects: [] };
  const np = rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < np; k++) r.projects.push({ type: pick(TYPES[mode]), team: pick(['us', 'them']) });
  r.tieWinner = pick(['us', 'them']);
  const o = B.scoreRound(r);
  if (o.error) continue; // e.g. two بلوت — the app never offers these
  scored++;
  const ctx = { r, o: { us: o.us, them: o.them, made: o.made, rule: o.detail.rule } };
  check('points are whole numbers, never negative', Number.isInteger(o.us) && Number.isInteger(o.them) && o.us >= 0 && o.them >= 0, ctx);
  check('same round → same result', JSON.stringify(B.scoreRound(JSON.parse(JSON.stringify(r)))) === JSON.stringify(o), ctx);
  const m = { ...r, buyer: flip(r.buyer), kaboot: r.kaboot && flip(r.kaboot), abnatUs: M.total - r.abnatUs, tieWinner: flip(r.tieWinner), projects: r.projects.map(p => ({ ...p, team: flip(p.team) })) };
  const om = B.scoreRound(m);
  // abnatUs 0 is not mirrored: 0 abnat does not prove كبوت for them (we may hold zero-point tricks); the app sends كبوت explicitly
  if (r.abnatUs > 0 || r.kaboot) check('mirror: swapping لنا/لهم swaps the score', !om.error && om.us === o.them && om.them === o.us && om.made === o.made, { ctx, mirror: om });
  const bal = t => o.valid.filter(p => p.type === 'baloot' && p.team === t).length * 2;
  const projPts = o.detail.projPts.us + o.detail.projPts.them;
  const loser = o.made === true ? flip(r.buyer) : o.made === false ? r.buyer : null;
  if (r.level === 'normal' && !o.kaboot && !o.valid.length && o.made !== false)
    check('normal round, no projects, buyer made it: points add up to 26 (صن) / 16 (حكم)', o.us + o.them === M.points, ctx);
  if (r.level === 'normal' && !o.kaboot && o.made === false)
    check('buyer failed: buyer gets only its own بلوت; the other team gets 26/16 + every project', o[r.buyer] === bal(r.buyer) && o[flip(r.buyer)] === M.points + projPts + bal(flip(r.buyer)), ctx);
  if (r.level !== 'normal' && loser)
    check('doubled round: the loser gets only its own بلوت', o[loser] === bal(loser), ctx);
  if (r.level !== 'normal' && !o.kaboot && loser) {
    const k = B.LEVELS[r.level].mult;
    check('doubled round: winner gets (26 or 16) × level + projects × level', o[flip(loser)] === M.points * k + projPts * k + bal(flip(loser)), ctx);
  }
  if (r.level === 'normal' && o.kaboot === r.buyer)
    check('كبوت by the buyer: 44 (صن) / 25 (حكم) + own projects', o[r.buyer] === M.kaboot + o.detail.projPts[r.buyer] + bal(r.buyer), ctx);
  const bigger = o.sums[r.buyer] > o.sums[flip(r.buyer)];
  if (!o.kaboot) check('buyer with more abnat (incl. projects) always makes it; with fewer always fails', bigger ? o.made === true : (o.sums[r.buyer] < o.sums[flip(r.buyer)] ? o.made === false : true), ctx);
  check('the raw abnat always add up to the full hand (130 / 162)', o.abnat.us + o.abnat.them === M.total, ctx);
}
const names = ['points are whole numbers, never negative', 'same round → same result', 'mirror: swapping لنا/لهم swaps the score',
  'normal round, no projects, buyer made it: points add up to 26 (صن) / 16 (حكم)', 'buyer failed: buyer gets only its own بلوت; the other team gets 26/16 + every project',
  'doubled round: the loser gets only its own بلوت', 'doubled round: winner gets (26 or 16) × level + projects × level', 'كبوت by the buyer: 44 (صن) / 25 (حكم) + own projects',
  'buyer with more abnat (incl. projects) always makes it; with fewer always fails', 'the raw abnat always add up to the full hand (130 / 162)'];
console.log(`${scored} random rounds scored (seed 20261111)`);
for (const n of names) { const b = bad[n]; if (b) { fail++; console.log('  ✗ ' + n + ` — ${b.n} failures, e.g.`, JSON.stringify(b.ex)); } else { pass++; console.log('  ✓ ' + n); } }

// every split of a real deck: the two piles' abnat (with the last trick) always add up to 130 / 162
const deck = []; for (const s of B.SUITS) for (const r of B.RANKS) deck.push({ rank: r, suit: s });
let deckBad = 0;
for (let i = 0; i < 3000; i++) {
  const mode = pick(['sun', 'hokm']), trump = pick(B.SUITS), sh = deck.slice().sort(() => rnd() - 0.5), cut = 4 * Math.floor(rnd() * 9);
  const last = cut === 0 ? 'them' : cut === 32 ? 'us' : pick(['us', 'them']);
  const a = B.pileAbnat(sh.slice(0, cut), mode, trump, last === 'us'), b = B.pileAbnat(sh.slice(cut), mode, trump, last === 'them');
  if (a + b !== B.MODE[mode].total) deckBad++;
}
if (deckBad) { fail++; console.log(`  ✗ card piles: ${deckBad} splits did not add up`); } else { pass++; console.log('  ✓ 3000 random card splits: both piles (with the last trick) always add up to 130 / 162'); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

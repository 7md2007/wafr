// Worked Baloot examples, each calculated by hand (expected numbers are written out, not computed by the engine).
// Run: node tests/baloot.examples.test.js          (prints every calculation)
//      node tests/baloot.examples.test.js --write  (also writes baloot/SCORING-EXAMPLES.md)
const B = require('../baloot/engine.js');
const fs = require('fs'), path = require('path');
const C = s => s.split(' ').map(x => ({ rank: x.slice(0, -1), suit: x.slice(-1) }));
const SUITAR = { S: '♠', H: '♥', D: '♦', C: '♣' };
const show = s => s.split(' ').map(x => x.slice(0, -1) + SUITAR[x.slice(-1)]).join(' ');
let pass = 0, fail = 0; const md = [];

function ex(o) {
  // o: {name, mode, trump, buyer, level, cards (our won cards, string), lastTrick, abnatUs (if no cards), kaboot, projects,
  //     calc: [hand-written steps], expect: {us, them, made}}
  let abnatUs = o.abnatUs, cardsLine = '';
  if (o.cards != null) {
    const raw = B.pileAbnat(C(o.cards), o.mode, o.trump, o.lastTrick);
    if (raw !== o.expectRaw) { fail++; console.log('  ✗', o.name, 'raw abnat', raw, '≠', o.expectRaw); return; }
    abnatUs = o.pileTeam === 'them' ? B.MODE[o.mode].total - raw : raw;
    cardsLine = `${o.pileTeam === 'them' ? 'their' : 'our'} won cards: ${show(o.cards)}${o.lastTrick ? ' + last trick' : ''}`;
  }
  const r = B.scoreRound({ mode: o.mode, trump: o.trump, buyer: o.buyer, level: o.level || 'normal', abnatUs, kaboot: o.kaboot || null,
    projects: o.projects || [], tieWinner: o.tieWinner, tieRule: o.tieRule, rules: o.rules, match: o.match });
  const got = r.error ? 'error:' + r.error : `${r.us}–${r.them}`;
  const want = o.expect.error ? 'error:' + o.expect.error : `${o.expect.us}–${o.expect.them}`;
  const good = got === want && (o.expect.made === undefined || r.made === o.expect.made);
  good ? pass++ : fail++;
  const head = `${o.mode === 'sun' ? 'Sun' : 'Hokm ' + SUITAR[o.trump]} · buyer ${o.buyer === 'us' ? 'us' : 'them'}${o.level && o.level !== 'normal' ? ' · ' + o.level : ''}`;
  console.log(`${good ? '  ✓' : '  ✗'} ${o.name}\n      ${head}${cardsLine ? '\n      ' + cardsLine : ''}`);
  o.calc.forEach(l => console.log('      · ' + l));
  console.log(`      expected us–them ${want} · engine ${got}${good ? '' : '   <-- MISMATCH'}`);
  md.push(`### ${o.name}\n- ${head}${cardsLine ? '\n- ' + cardsLine : ''}\n${o.calc.map(l => '- ' + l).join('\n')}\n- **Expected: us ${o.expect.us ?? '—'} · them ${o.expect.them ?? '—'}** · engine: ${got} ${good ? '✓' : '✗'}\n`);
}

console.log('A. Card values and the photographed-hand problem');
ex({ name: 'A1 Hokm, our complete won tricks scanned (2 tricks) — buyer us makes it',
  mode: 'hokm', trump: 'H', buyer: 'us', cards: 'JH 9H AH 10H AS 10S KS QS', pileTeam: 'us', lastTrick: true, expectRaw: 93,
  calc: ['trump J 20 + trump 9 14 + A 11 + 10 10 = 55; A♠ 11 + 10♠ 10 + K 4 + Q 3 = 28; cards 83 + last trick 10 = 93',
    'them = 162 − 93 = 69; buyer 93 > 69 → made', 'points: 93 → 9 (3 rounds down), 69 → 7 (9 rounds up); 9 + 7 = 16'],
  expect: { us: 9, them: 7, made: true } });
ex({ name: 'A2 The +16 / +0 case: a player\'s HAND photographed and counted as our won tricks (wrong input)',
  mode: 'hokm', trump: 'H', buyer: 'us', cards: 'KH QH 7S 8S 9D 8C AC 10D', pileTeam: 'us', lastTrick: false, expectRaw: 28,
  calc: ['K♥ 4 + Q♥ 3 + 7/8/9 side cards 0 + A♣ 11 + 10♦ 10 = 28 (no last trick)', 'treated as ALL our tricks: them = 162 − 28 = 134',
    'buyer 28 < 134 → buyer fails → them take the whole round: 16, us 0',
    'the engine is right for that input — the input was wrong. Fix: a hand photo now only finds projects (here بلوت K♥ Q♥) and the app asks for the trick result.'],
  expect: { us: 0, them: 16, made: false } });
ex({ name: 'A3 Sun, their complete tricks scanned — buyer them',
  mode: 'sun', buyer: 'them', cards: 'AS 10S KS QS AH 10H KH QH AD 10D KD QD', pileTeam: 'them', lastTrick: true, expectRaw: 94,
  calc: ['each suit A 11 + 10 10 + K 4 + Q 3 = 28; ×3 = 84 + last trick 10 = 94 for them', 'us = 130 − 94 = 36; buyer 94 > 36 → made',
    'points ÷5: 36 → 7.2 → 7, 94 → 18.8 → 19; 7 + 19 = 26'],
  expect: { us: 7, them: 19, made: true } });

console.log('\nB. Rounding and contract result (abnat typed in)');
ex({ name: 'B1 Hokm 85–77 (a 5 rounds down)', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 85,
  calc: ['85 → 8, 77 → 8 (7.7 rounds up); 8 + 8 = 16', 'buyer 85 > 77 → made'], expect: { us: 8, them: 8, made: true } });
ex({ name: 'B2 Hokm 86–76 (both end in 6) — RULE VARIANT, confirm', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 86,
  calc: ['plain rounding gives 9 + 8 = 17 > 16', 'app: the side with more abnat keeps 9, the other gets 16 − 9 = 7'], expect: { us: 9, them: 7, made: true } });
ex({ name: 'B3 Hokm buyer fails 70–92', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 70,
  calc: ['buyer 70 < 92 → fails', 'other team takes all 16; buyer 0'], expect: { us: 0, them: 16, made: false } });
ex({ name: 'B4 Sun 58–72, buyer them', mode: 'sun', buyer: 'them', abnatUs: 58,
  calc: ['58 ÷ 5 = 11.6 → 12, 72 ÷ 5 = 14.4 → 14; 12 + 14 = 26', 'buyer 72 > 58 → made'], expect: { us: 12, them: 14, made: true } });
ex({ name: 'B5 Sun buyer fails 60–70', mode: 'sun', buyer: 'us', abnatUs: 60,
  calc: ['buyer 60 < 70 → fails', 'them take all 26'], expect: { us: 0, them: 26, made: false } });
ex({ name: 'B6 Hokm 81–81 tie — RULE VARIANT (default: each keeps own)', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 81,
  calc: ['81 → 8, 81 → 8', 'tie: each team keeps its points (setting can make the buyer lose)'], expect: { us: 8, them: 8, made: 'tie' } });

console.log('\nC. Projects');
ex({ name: 'C1 Sun سرا for the buyer', mode: 'sun', buyer: 'us', abnatUs: 60, projects: [{ type: 'sira', team: 'us' }],
  calc: ['سرا = 20 abnat (4 points in Sun)', 'buyer 60 + 20 = 80 > 70 → made', 'points 60 → 12 + 4 = 16; them 70 → 14'], expect: { us: 16, them: 14, made: true } });
ex({ name: 'C2 Sun خمسين for the other team makes the buyer fail', mode: 'sun', buyer: 'them', abnatUs: 60, projects: [{ type: 'fifty', team: 'us' }],
  calc: ['خمسين = 50 abnat (10 points)', 'buyer (them) 70 vs us 60 + 50 = 110 → buyer fails', 'us take 26 + 10 = 36'], expect: { us: 36, them: 0, made: false } });
ex({ name: 'C3 Sun أربعمية cancels their مية', mode: 'sun', buyer: 'us', abnatUs: 50, projects: [{ type: 'fourHundred', team: 'us' }, { type: 'hundred', team: 'them' }],
  calc: ['أربعمية (4 aces, Sun only) = 200 abnat / 40 points; it beats their مية, which is cancelled', 'buyer 50 + 200 = 250 > 80 → made',
    'us 50 → 10 + 40 = 50; them 80 → 16'], expect: { us: 50, them: 16, made: true } });
ex({ name: 'C4 Hokm مية (5 in a row)', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 75, projects: [{ type: 'hundred', team: 'us' }],
  calc: ['مية = 100 abnat / 10 points in Hokm', 'buyer 75 + 100 = 175 > 87 → made', '75 → 7 (5 down) + 10 = 17; 87 → 9'], expect: { us: 17, them: 9, made: true } });
ex({ name: 'C5 Hokm: their خمسين cancels our سرا', mode: 'hokm', trump: 'S', buyer: 'them', abnatUs: 70, projects: [{ type: 'sira', team: 'us' }, { type: 'fifty', team: 'them' }],
  calc: ['خمسين ranks above سرا → our سرا cancelled', 'buyer (them) 92 + 50 = 142 > 70 → made', 'us 70 → 7; them 92 → 9 + 5 = 14'], expect: { us: 7, them: 14, made: true } });
ex({ name: 'C6 Hokm two سرا + خمسين for one team', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100,
  projects: [{ type: 'sira', team: 'us' }, { type: 'sira', team: 'us' }, { type: 'fifty', team: 'us' }],
  calc: ['projects 2 + 2 + 5 = 9 points', '100 → 10 + 9 = 19; 62 → 6'], expect: { us: 19, them: 6, made: true } });
ex({ name: 'C7 Hokm بلوت helps the buyer make it', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 72, projects: [{ type: 'baloot', team: 'us' }],
  calc: ['بلوت = 20 abnat / 2 points', 'buyer 72 + 20 = 92 > 90 → made — RULE VARIANT: some groups do not count بلوت here', '72 → 7 + 2 = 9; 90 → 9'], expect: { us: 9, them: 9, made: true } });
ex({ name: 'C8 Hokm بلوت stays with its owner when the buyer fails', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 60, projects: [{ type: 'baloot', team: 'us' }],
  calc: ['buyer 60 + 20 = 80 < 102 → fails', 'them 16; بلوت 2 stays with us'], expect: { us: 2, them: 16, made: false } });
ex({ name: 'C9 بلوت is not allowed in Sun', mode: 'sun', buyer: 'us', abnatUs: 70, projects: [{ type: 'baloot', team: 'us' }],
  calc: ['بلوت needs a trump suit → rejected'], expect: { error: 'projects' } });
ex({ name: 'C10 أربعمية is not allowed in Hokm (4 aces = مية)', mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 90, projects: [{ type: 'fourHundred', team: 'us' }],
  calc: ['rejected'], expect: { error: 'projects' } });

console.log('\nD. Kaboot (كبوت)');
ex({ name: 'D1 Sun كبوت by the buyer with مية', mode: 'sun', buyer: 'us', kaboot: 'us', projects: [{ type: 'hundred', team: 'us' }],
  calc: ['all 8 tricks: كبوت = 44 in Sun', '+ مية 20 = 64'], expect: { us: 64, them: 0, made: true } });
ex({ name: 'D2 Hokm كبوت by the other team, buyer had سرا', mode: 'hokm', trump: 'C', buyer: 'us', kaboot: 'them', projects: [{ type: 'sira', team: 'us' }],
  calc: ['buyer took no tricks → fails', 'them 25 (كبوت) + the سرا 2 = 27'], expect: { us: 0, them: 27, made: false } });
ex({ name: 'D3 typing all 130 abnat = كبوت', mode: 'sun', buyer: 'us', abnatUs: 130, calc: ['130 = every card + last trick → كبوت 44'], expect: { us: 44, them: 0, made: true } });

console.log('\nE. Doubling');
ex({ name: 'E1 Hokm دبل, buyer makes it', mode: 'hokm', trump: 'S', buyer: 'us', level: 'double', abnatUs: 100,
  calc: ['doubled round: winner takes all', '16 × 2 = 32 to the buyer'], expect: { us: 32, them: 0, made: true } });
ex({ name: 'E2 Hokm دبل, buyer fails', mode: 'hokm', trump: 'S', buyer: 'us', level: 'double', abnatUs: 70, calc: ['70 < 92 → them 32'], expect: { us: 0, them: 32, made: false } });
ex({ name: 'E3 Hokm ثري', mode: 'hokm', trump: 'S', buyer: 'them', level: 'three', abnatUs: 40, calc: ['them 122 > 40 → 16 × 3 = 48'], expect: { us: 0, them: 48, made: true } });
ex({ name: 'E4 Hokm فور', mode: 'hokm', trump: 'S', buyer: 'them', level: 'four', abnatUs: 40, calc: ['16 × 4 = 64'], expect: { us: 0, them: 64, made: true } });
ex({ name: 'E5 Hokm دبل with خمسين and their بلوت', mode: 'hokm', trump: 'S', buyer: 'us', level: 'double', abnatUs: 100,
  projects: [{ type: 'fifty', team: 'us' }, { type: 'baloot', team: 'them' }],
  calc: ['buyer 100 + 50 = 150 > 62 + 20 = 82 → made', 'us 32 + خمسين 5 × 2 = 42; their بلوت stays 2 (never doubled)'], expect: { us: 42, them: 2, made: true } });
ex({ name: 'E6 Hokm دبل tie 81–81 — RULE VARIANT: buyer loses', mode: 'hokm', trump: 'S', buyer: 'us', level: 'double', abnatUs: 81,
  calc: ['a tie in a doubled round goes against the buyer → them 32'], expect: { us: 0, them: 32, made: false } });
ex({ name: 'E7 Sun دبل, buyer fails', mode: 'sun', buyer: 'us', level: 'double', abnatUs: 60, calc: ['60 < 70 → them 26 × 2 = 52'], expect: { us: 0, them: 52, made: false } });
ex({ name: 'E8 Sun ثري is impossible', mode: 'sun', buyer: 'us', level: 'three', abnatUs: 80, calc: ['Sun allows only دبل'], expect: { error: 'level' } });
ex({ name: 'E9 Hokm قهوة at 90–120, buyer wins the round', mode: 'hokm', trump: 'H', buyer: 'us', level: 'gahwa', abnatUs: 100, match: { us: 90, them: 120, target: 152 },
  calc: ['قهوة: the round winner wins the game', 'us need 152 − 90 = 62 → shown as +62'], expect: { us: 62, them: 0, made: true } });
ex({ name: 'E10 Hokm دبل + كبوت — RULE VARIANT (default multiplied)', mode: 'hokm', trump: 'S', buyer: 'us', level: 'double', kaboot: 'us',
  calc: ['25 × 2 = 50 (setting: not multiplied → 25)'], expect: { us: 50, them: 0, made: true } });

console.log('\nF. When doubling is offered');
const offer = (n, got, want) => { const g = got.join(','); const ok = g === want; ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${n}: ${g}`); md.push(`- ${n}: ${g} ${ok ? '✓' : '✗ expected ' + want}`); };
md.push('### F. When doubling is offered');
offer('Hokm, any score', B.doublingOptions('hokm', 'us', { us: 0, them: 0 }), 'normal,double,three,four,gahwa');
offer('Sun at 0–0', B.doublingOptions('sun', 'us', { us: 0, them: 0 }), 'normal');
offer('Sun, buyer 104 / other 60', B.doublingOptions('sun', 'us', { us: 104, them: 60 }), 'normal,double');
offer('Sun, buyer 60 / other 120', B.doublingOptions('sun', 'us', { us: 60, them: 120 }), 'normal');

console.log(`\n${pass} passed, ${fail} failed`);
if (process.argv.includes('--write')) {
  const doc = `# Baloot scoring — worked examples\n\nGenerated by \`node tests/baloot.examples.test.js --write\`. Expected numbers were calculated by hand; "engine" is what the app computes.\n` +
    `Rules marked **RULE VARIANT** differ between groups and can be changed in the app's settings (⋯).\n\n` +
    `Card values — Sun: A 11 · 10 10 · K 4 · Q 3 · J 2 · 9/8/7 0 (120 + last trick 10 = 130 = 26 points, ÷5).\n` +
    `Hokm trump: J 20 · 9 14 · A 11 · 10 10 · K 4 · Q 3 · 8/7 0; other suits as Sun (152 + 10 = 162 = 16 points, ÷10, a 5 rounds down).\n\n` + md.join('\n') + `\n\n**${pass} passed, ${fail} failed**\n`;
  fs.writeFileSync(path.join(__dirname, '../baloot/SCORING-EXAMPLES.md'), doc);
  console.log('wrote baloot/SCORING-EXAMPLES.md');
}
process.exit(fail ? 1 : 0);

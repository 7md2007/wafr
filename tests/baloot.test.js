// Baloot scoring engine tests — run: node tests/baloot.test.js
const B = require('../baloot/engine.js');
let pass = 0, fail = 0;
const ok = (name, c, info) => { if (c) { pass++; console.log('  ✓', name) } else { fail++; console.log('  ✗', name, info !== undefined ? JSON.stringify(info) : '') } };
const deck = () => B.SUITS.flatMap(suit => B.RANKS.map(rank => ({ rank, suit })));
const C = s => s.split(' ').map(x => ({ rank: x.slice(0, -1), suit: x.slice(-1) }));
const R = o => B.scoreRound(Object.assign({ projects: [], kaboot: null }, o));

console.log('#1 card values');
ok('Sun: full deck = 120 abnat (+10 last trick = 130)', B.handAbnat(deck(), 'sun') === 120 && B.MODE.sun.total === 130);
ok('Hokm: full deck = 152 abnat (+10 last trick = 162)', B.handAbnat(deck(), 'hokm', 'H') === 152 && B.MODE.hokm.total === 162);
ok('Hokm trump J = 20, trump 9 = 14, side J = 2', B.cardAbnat({ rank: 'J', suit: 'H' }, 'hokm', 'H') === 20 && B.cardAbnat({ rank: '9', suit: 'H' }, 'hokm', 'H') === 14 && B.cardAbnat({ rank: 'J', suit: 'S' }, 'hokm', 'H') === 2);

console.log('#2 abnat → points');
const tp = (m, a) => { const p = B.toPoints(m, a); return p.us + '-' + p.them };
ok('Sun 65 = 13–13', tp('sun', 65) === '13-13');
ok('Sun 66 = 13–13, 68 = 14–12, 67 = 13–13', tp('sun', 66) === '13-13' && tp('sun', 68) === '14-12' && tp('sun', 67) === '13-13');
ok('Sun always adds up to 26', [...Array(131).keys()].every(a => { const p = B.toPoints('sun', a); return p.us + p.them === 26 }));
ok('Hokm 81 = 8–8', tp('hokm', 81) === '8-8');
ok('Hokm 85–77 = 8–8 (a 5 rounds down)', tp('hokm', 85) === '8-8');
ok('Hokm 87–75 = 9–7', tp('hokm', 87) === '9-7');
ok('Hokm 86–76 = 9–7 (both end in 6: more abnat keeps the rounding)', tp('hokm', 86) === '9-7' && tp('hokm', 76) === '7-9');
ok('Hokm always adds up to 16', [...Array(163).keys()].every(a => { const p = B.toPoints('hokm', a); return p.us + p.them === 16 }));

console.log('#3 project values');
const pv = (t, m) => B.projectPoints(t, m);
ok('Sun: سرا 4, خمسين 10, مية 20, أربعمية 40', pv('sira', 'sun') === 4 && pv('fifty', 'sun') === 10 && pv('hundred', 'sun') === 20 && pv('fourHundred', 'sun') === 40);
ok('Hokm: سرا 2, خمسين 5, مية 10, بلوت 2', pv('sira', 'hokm') === 2 && pv('fifty', 'hokm') === 5 && pv('hundred', 'hokm') === 10 && pv('baloot', 'hokm') === 2);
ok('Sun offers no بلوت; Hokm offers no أربعمية', !B.allowedProjects('sun').includes('baloot') && !B.allowedProjects('hokm').includes('fourHundred'));
ok('بلوت in Sun is rejected', R({ mode: 'sun', buyer: 'us', abnatUs: 70, projects: [{ type: 'baloot', team: 'us' }] }).error === 'projects');
ok('أربعمية in Hokm is rejected', R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 90, projects: [{ type: 'fourHundred', team: 'us' }] }).error === 'projects');
ok('two أربعمية or two بلوت are rejected', B.validateProjects('sun', [{ type: 'fourHundred', team: 'us' }, { type: 'fourHundred', team: 'them' }]).length > 0 && B.validateProjects('hokm', [{ type: 'baloot', team: 'us' }, { type: 'baloot', team: 'them' }]).length > 0);
ok('Hokm needs a trump suit', R({ mode: 'hokm', buyer: 'us', abnatUs: 90 }).error === 'trump');

console.log('#4 buyer makes / fails');
let r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100 });
ok('Hokm buyer 100–62 → 10–6', r.made === true && r.us === 10 && r.them === 6, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 70 });
ok('Hokm buyer 70–92 fails → 0–16', r.made === false && r.us === 0 && r.them === 16, r);
r = R({ mode: 'sun', buyer: 'them', abnatUs: 40 });
ok('Sun buyer (them) 90–40 → 8–18', r.made === true && r.us === 8 && r.them === 18, r);
r = R({ mode: 'sun', buyer: 'them', abnatUs: 80 });
ok('Sun buyer (them) 50–80 fails → us 26, them 0', r.made === false && r.us === 26 && r.them === 0, r);

console.log('#5 ties');
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 81 });
ok('Hokm 81–81 (split rule) → 8–8, shown as tie', r.made === 'tie' && r.us === 8 && r.them === 8, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 81, tieRule: 'buyerLoses' });
ok('Hokm 81–81 ("buyer loses" rule) → 0–16', r.made === false && r.us === 0 && r.them === 16, r);
r = R({ mode: 'sun', buyer: 'them', abnatUs: 65, tieRule: 'buyerLoses' });
ok('Sun 65–65 ("buyer loses" rule) → us 26', r.made === false && r.us === 26 && r.them === 0, r);

console.log('#6 projects in the result');
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100, projects: [{ type: 'fifty', team: 'us' }] });
ok('Hokm buyer 100 + خمسين → 15–6', r.us === 15 && r.them === 6, r);
r = R({ mode: 'sun', buyer: 'them', abnatUs: 60, projects: [{ type: 'fifty', team: 'us' }] });
ok('Sun: buyer (them) 70 vs us 60 + 50 → buyer fails, us 26 + 10 = 36', r.made === false && r.us === 36 && r.them === 0, r);
r = R({ mode: 'sun', buyer: 'us', abnatUs: 60, projects: [{ type: 'fourHundred', team: 'us' }, { type: 'hundred', team: 'them' }] });
ok('Sun: أربعمية cancels their مية → 12 + 40 = 52 vs 14', r.made === true && r.us === 52 && r.them === 14 && r.cancelled.length === 1, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 90, projects: [{ type: 'sira', team: 'us' }, { type: 'fifty', team: 'them' }] });
ok('Hokm: their خمسين cancels our سرا; 90 vs 72+50 → buyer fails, them 16 + 5 = 21', r.made === false && r.us === 0 && r.them === 21, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100, projects: [{ type: 'sira', team: 'us' }, { type: 'sira', team: 'us' }, { type: 'fifty', team: 'us' }] });
ok('several projects of the winning team all count (2 سرا + خمسين = 9)', r.us === 10 + 9 && r.them === 6, r);

console.log('#7 baloot');
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 60, projects: [{ type: 'baloot', team: 'us' }] });
ok('بلوت stays with its owner even when the buyer fails (0+2 vs 16)', r.made === false && r.us === 2 && r.them === 16, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100, projects: [{ type: 'baloot', team: 'them' }, { type: 'fifty', team: 'us' }] });
ok('بلوت is not cancelled by a bigger project', r.us === 15 && r.them === 8, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 72, projects: [{ type: 'baloot', team: 'us' }] });
ok('بلوت counts toward making the contract (72+20 = 92 vs 90)', r.made === true && r.us === 7 + 2 && r.them === 9, r);

console.log('#8 equal projects');
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100, projects: [{ type: 'sira', team: 'us' }, { type: 'sira', team: 'them' }] });
ok('same project type on both sides → asks who wins', r.error === 'needTie', r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100, tieWinner: 'them', projects: [{ type: 'sira', team: 'us' }, { type: 'sira', team: 'them' }] });
ok('answer "them" → only their سرا counts', r.us === 10 && r.them === 6 + 2, r);
r = R({ mode: 'hokm', trump: 'S', buyer: 'us', abnatUs: 100, projects: [{ type: 'sira', team: 'us', top: 0 }, { type: 'sira', team: 'them', top: 2 }] });
ok('known top cards decide automatically (A-K-Q beats Q-J-10)', r.us === 12 && r.them === 6, r);

console.log('#9 kaboot');
r = R({ mode: 'sun', buyer: 'us', kaboot: 'us', projects: [{ type: 'hundred', team: 'us' }] });
ok('Sun كبوت by buyer with مية → 44 + 20 = 64', r.made === true && r.us === 64 && r.them === 0, r);
r = R({ mode: 'hokm', trump: 'C', buyer: 'us', kaboot: 'us' });
ok('Hokm كبوت = 25', r.us === 25 && r.them === 0, r);
r = R({ mode: 'hokm', trump: 'C', buyer: 'us', kaboot: 'them', projects: [{ type: 'sira', team: 'us' }] });
ok('Hokm كبوت by the other team → buyer fails, they take 25 + the سرا = 27', r.made === false && r.us === 0 && r.them === 27, r);

console.log('#10 projects from a photo of a hand');
const names = l => l.map(p => p.type).sort().join(',');
ok('Sun: 4 aces + K-Q-J ♠ → أربعمية + سرا', names(B.detectProjects(C('AS AH AD AC KS QS JS 7H'), 'sun')) === 'fourHundred,sira');
ok('Hokm: 4 aces → مية (no أربعمية in Hokm)', names(B.detectProjects(C('AS AH AD AC 8S 7D 9C 8H'), 'hokm', 'S')) === 'hundred');
ok('Hokm trump ♥: K-Q-J ♥ → سرا + بلوت', names(B.detectProjects(C('KH QH JH 7S 9D 8C AC 10D'), 'hokm', 'H')) === 'baloot,sira');
ok('5 in a row → مية; 4 in a row → خمسين', names(B.detectProjects(C('AD KD QD JD 10D 8S 7S 9H'), 'sun')) === 'hundred' && names(B.detectProjects(C('10C 9C 8C 7C AS KH QD JH'), 'sun')) === 'fifty');
ok('a card is not used twice (4 kings + Q-J ♠ only)', names(B.detectProjects(C('KS KH KD KC QS JS 7D 8H'), 'sun')) === 'hundred');
ok('nothing in a plain hand', B.detectProjects(C('AS 9H 7D KC QS 10H 8C JD'), 'sun').length === 0);
ok('9s/8s/7s four of a kind are not a project', B.detectProjects(C('9S 9H 9D 9C 7S 7H 7D 7C'), 'sun').length === 0);

console.log('#11 photo of collected cards (pile)');
const pile = C('AS 10S KS QS AH 10H KH QH');
ok('Sun pile A 10 K Q ×2 = 56, with last trick 66', B.pileAbnat(pile, 'sun', null, false) === 56 && B.pileAbnat(pile, 'sun', null, true) === 66);
ok('Hokm ♠ pile: trump J + 9 + 7 + 8 = 34', B.pileAbnat(C('JS 9S 7S 8S'), 'hokm', 'S', false) === 34);
ok('duplicate card is rejected', B.pileAbnat(C('AS AS KS QS'), 'sun', null, false) === null);
ok('a count that is not whole tricks is rejected', B.pileAbnat(C('AS KS QS'), 'sun', null, false) === null);
ok('all 32 cards must include the last trick', B.pileAbnat(deck(), 'sun', null, false) === null && B.pileAbnat(deck(), 'sun', null, true) === 130);
ok('Hokm all 32 cards = 162', B.pileAbnat(deck(), 'hokm', 'D', true) === 162);

console.log('#12 impossible abnat');
ok('Sun: 1 and 129 are impossible, 0/2/65/130 possible', !B.isPossibleAbnat('sun', 1) && !B.isPossibleAbnat('sun', 129) && [0, 2, 65, 130].every(a => B.isPossibleAbnat('sun', a)));
ok('Hokm: 1 and 161 are impossible, 81/162 possible', !B.isPossibleAbnat('hokm', 1) && !B.isPossibleAbnat('hokm', 161) && B.isPossibleAbnat('hokm', 81) && B.isPossibleAbnat('hokm', 162));
ok('out of range is impossible', !B.isPossibleAbnat('sun', 131) && !B.isPossibleAbnat('hokm', -2) && !B.isPossibleAbnat('sun', 2.5));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

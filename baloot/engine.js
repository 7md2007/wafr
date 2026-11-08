/* Baloot scoring engine (Gulf / Saudi rules). Pure functions, no DOM.
   Used by baloot/index.html and tests/baloot.test.js.

   Units: "abnat" (أبناط) = card points counted in tricks; "points" (نقاط/قيد) = what is written on the score sheet.
   Sun (صن):   card total 120 + last trick 10 = 130 abnat = 26 points  (points = abnat ÷ 5, rounded)
   Hokm (حكم): card total 152 + last trick 10 = 162 abnat = 16 points  (points = abnat ÷ 10, a 5 rounds down)

   Rules that differ between groups are options (see DEFAULTS), never hidden guesses. */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C']; // ♠ سبيت · ♥ هاص · ♦ ديمن · ♣ كلفس
  const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7']; // natural order used for sequences (سرا/خمسين/مية)

  const SUN_PTS = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
  const TRUMP_PTS = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };
  const LAST_TRICK = 10; // الأرض

  const MODE = {
    sun: { total: 130, points: 26, kaboot: 44 },
    hokm: { total: 162, points: 16, kaboot: 25 },
  };

  /* Project values in abnat. Points follow the same conversion as tricks:
     Sun ÷5 → سرا 4, خمسين 10, مية 20, أربعمية 40 ; Hokm ÷10 → سرا 2, خمسين 5, مية 10, بلوت 2. */
  const PROJECTS = {
    sira:        { ar: 'سرا',      en: 'Sira (3 in a row)',  abnat: 20,  rank: 1, modes: ['sun', 'hokm'] },
    fifty:       { ar: 'خمسين',    en: '50 (4 in a row)',    abnat: 50,  rank: 2, modes: ['sun', 'hokm'] },
    hundred:     { ar: 'مية',      en: '100',                abnat: 100, rank: 3, modes: ['sun', 'hokm'] },
    fourHundred: { ar: 'أربعمية',  en: '400 (4 aces, Sun)',  abnat: 200, rank: 4, modes: ['sun'] },
    baloot:      { ar: 'بلوت',     en: 'Baloot (K+Q trump)', abnat: 20,  rank: 0, modes: ['hokm'] },
  };
  const PROJECT_ORDER = ['sira', 'fifty', 'hundred', 'fourHundred', 'baloot'];

  const DEFAULTS = {
    // What happens when the buyer's total equals the other team's (e.g. 81–81 in Hokm, 65–65 in Sun):
    // 'split' = each team keeps its own points (tournament rule), 'buyerLoses' = treated as a lost contract.
    tieRule: 'split',
  };

  const other = t => (t === 'us' ? 'them' : 'us');

  function cardAbnat(card, mode, trump) {
    if (mode === 'hokm' && card.suit === trump) return TRUMP_PTS[card.rank];
    return SUN_PTS[card.rank];
  }
  function handAbnat(cards, mode, trump) {
    return cards.reduce((s, c) => s + cardAbnat(c, mode, trump), 0);
  }

  function projectPoints(type, mode) {
    const p = PROJECTS[type];
    return mode === 'sun' ? p.abnat / 5 : p.abnat / 10;
  }
  function allowedProjects(mode) {
    return PROJECT_ORDER.filter(t => PROJECTS[t].modes.includes(mode));
  }

  /* Abnat → points. Sun: ÷5 (never lands on .5). Hokm: ÷10, a units digit of 5 or less rounds down, 6+ rounds up.
     The two sides must add up to the round total; when both round up (e.g. 86–76) the side with more abnat keeps
     its rounding and the other gets the rest (9–7). */
  function hokmRound(a) { return Math.floor(a / 10) + (a % 10 > 5 ? 1 : 0); }
  function toPoints(mode, abnatUs) {
    const M = MODE[mode];
    const abnatThem = M.total - abnatUs;
    if (mode === 'sun') { const us = Math.round(abnatUs / 5); return { us, them: M.points - us }; }
    let us = hokmRound(abnatUs), them = hokmRound(abnatThem);
    if (us + them !== M.points) {
      if (abnatUs >= abnatThem) them = M.points - us; else us = M.points - them;
    }
    return { us, them };
  }

  /* Validation: only projects that exist in this mode, and counts that are physically possible. */
  function validateProjects(mode, projects) {
    const errs = [];
    const count = (type, team) => projects.filter(p => p.type === type && (!team || p.team === team)).length;
    for (const p of projects) {
      if (!PROJECTS[p.type]) { errs.push('unknown:' + p.type); continue; }
      if (!PROJECTS[p.type].modes.includes(mode)) errs.push('notInMode:' + p.type);
      if (p.team !== 'us' && p.team !== 'them') errs.push('noTeam:' + p.type);
    }
    if (count('fourHundred') > 1) errs.push('only one 400 (there are 4 aces)');
    if (count('baloot') > 1) errs.push('only one baloot (one K+Q of trump)');
    // Each player has 8 cards → at most 2 projects of 3+ cards; a team has 2 players.
    for (const team of ['us', 'them']) {
      const big = projects.filter(p => p.team === team && p.type !== 'baloot').length;
      if (big > 4) errs.push('too many projects for ' + team);
    }
    // 100 from four of a kind: K/Q/J/10 (+A in Hokm) → at most 4 (5 in Hokm) such sets; sequences add more, so keep a loose cap.
    if (count('hundred') > 6) errs.push('too many 100s');
    return errs;
  }

  /* Only the team holding the strongest project scores its projects; the other team's projects are cancelled.
     Baloot is never cancelled. If both teams' best projects are the same type, the higher top card wins
     (when given as `top`, index into RANKS: 0 = Ace), otherwise the user says who wins (`tieWinner`:
     the higher cards, or the player who plays first when exactly equal). */
  function resolveProjects(mode, projects, tieWinner) {
    const big = projects.filter(p => p.type !== 'baloot');
    const best = team => {
      const mine = big.filter(p => p.team === team);
      if (!mine.length) return null;
      return mine.reduce((a, b) => {
        const ra = PROJECTS[a.type].rank, rb = PROJECTS[b.type].rank;
        if (rb !== ra) return rb > ra ? b : a;
        const ta = a.top == null ? 99 : a.top, tb = b.top == null ? 99 : b.top;
        return tb < ta ? b : a;
      });
    };
    const bu = best('us'), bt = best('them');
    let winner = null, needTie = false;
    if (bu && !bt) winner = 'us';
    else if (bt && !bu) winner = 'them';
    else if (bu && bt) {
      const ru = PROJECTS[bu.type].rank, rt = PROJECTS[bt.type].rank;
      if (ru !== rt) winner = ru > rt ? 'us' : 'them';
      else if (bu.top != null && bt.top != null && bu.top !== bt.top) winner = bu.top < bt.top ? 'us' : 'them';
      else if (tieWinner === 'us' || tieWinner === 'them') winner = tieWinner;
      else needTie = true;
    }
    const valid = [], cancelled = [];
    for (const p of projects) {
      if (p.type === 'baloot' || (winner && p.team === winner)) valid.push(p);
      else cancelled.push(p);
    }
    return { winner, needTie, valid, cancelled };
  }

  /* Score one round.
     r = { mode:'sun'|'hokm', trump, buyer:'us'|'them', abnatUs (trick abnat incl. last trick, 0..total),
           kaboot: null|'us'|'them', projects:[{type,team,top?}], tieWinner, tieRule } */
  function scoreRound(r) {
    const mode = r.mode, M = MODE[mode];
    if (!M) return { error: 'mode' };
    if (mode === 'hokm' && !SUITS.includes(r.trump)) return { error: 'trump' };
    if (r.buyer !== 'us' && r.buyer !== 'them') return { error: 'buyer' };
    const projects = (r.projects || []).filter(Boolean);
    const errs = validateProjects(mode, projects);
    if (errs.length) return { error: 'projects', errors: errs };
    const res = resolveProjects(mode, projects, r.tieWinner);
    if (res.needTie) return { error: 'needTie', needTie: true };

    const tieRule = r.tieRule || DEFAULTS.tieRule;
    const pAb = { us: 0, them: 0 }, pPts = { us: 0, them: 0 }, bal = { us: 0, them: 0 };
    for (const p of res.valid) {
      pAb[p.team] += PROJECTS[p.type].abnat;
      if (p.type === 'baloot') bal[p.team] += projectPoints('baloot', mode);
      else pPts[p.team] += projectPoints(p.type, mode);
    }
    const buyer = r.buyer, opp = other(buyer);
    const out = { us: 0, them: 0, made: null, kaboot: r.kaboot || null, valid: res.valid, cancelled: res.cancelled };

    const lostTo = winnerTeam => { // the winner takes the whole round and every project; baloot stays with its owner
      out[winnerTeam] = M.points + pPts.us + pPts.them;
      out.us += bal.us; out.them += bal.them;
    };

    if (r.kaboot === 'us' || r.kaboot === 'them') {
      const k = r.kaboot;
      if (k === buyer) {
        out.made = true;
        out[k] = M.kaboot + pPts[k] + bal[k];
        out[other(k)] = pPts[other(k)] + bal[other(k)];
      } else {
        out.made = false;
        out[k] = M.kaboot + pPts.us + pPts.them;
        out.us += bal.us; out.them += bal.them;
      }
      out.abnat = { us: k === 'us' ? M.total : 0, them: k === 'them' ? M.total : 0 };
      return out;
    }

    const a = Number(r.abnatUs);
    if (!Number.isInteger(a) || a < 0 || a > M.total) return { error: 'abnat' };
    const ab = { us: a, them: M.total - a };
    out.abnat = ab;
    const sum = { us: ab.us + pAb.us, them: ab.them + pAb.them };
    out.sums = sum;
    const base = toPoints(mode, a);

    if (sum[buyer] > sum[opp] || (sum[buyer] === sum[opp] && tieRule === 'split')) {
      out.made = sum[buyer] === sum[opp] ? 'tie' : true;
      out.us = base.us + pPts.us + bal.us;
      out.them = base.them + pPts.them + bal.them;
    } else {
      out.made = false;
      lostTo(opp);
    }
    return out;
  }

  /* Projects visible in a set of cards (one player's hand from a photo). A card is used once, except that
     K+Q of trump also make Baloot. Tries both ways for four-of-a-kind and keeps the most valuable split. */
  function detectProjects(cards, mode, trump) {
    const uniq = [];
    for (const c of cards) if (RANKS.includes(c.rank) && SUITS.includes(c.suit) && !uniq.some(u => u.rank === c.rank && u.suit === c.suit)) uniq.push(c);
    const kinds = ['A', 'K', 'Q', 'J', '10'].filter(rk => uniq.filter(c => c.rank === rk).length === 4);
    let bestList = [];
    let bestVal = -1;
    const subsets = 1 << kinds.length;
    for (let m = 0; m < subsets; m++) {
      const list = [];
      const used = new Set();
      kinds.forEach((rk, i) => {
        if (!(m & (1 << i))) return;
        const type = rk === 'A' && mode === 'sun' ? 'fourHundred' : 'hundred';
        list.push({ type, top: RANKS.indexOf(rk), kind: rk, cards: SUITS.map(s => rk + s) });
        SUITS.forEach(s => used.add(rk + s));
      });
      for (const s of SUITS) {
        let run = [];
        const flush = () => {
          if (run.length >= 3) {
            const type = run.length >= 5 ? 'hundred' : run.length === 4 ? 'fifty' : 'sira';
            list.push({ type, top: RANKS.indexOf(run[0]), suit: s, cards: run.map(rk => rk + s) });
          }
          run = [];
        };
        for (const rk of RANKS) {
          if (!used.has(rk + s) && uniq.some(c => c.rank === rk && c.suit === s)) run.push(rk); else flush();
        }
        flush();
      }
      const val = list.reduce((t, p) => t + PROJECTS[p.type].abnat, 0);
      if (val > bestVal) { bestVal = val; bestList = list; }
    }
    if (mode === 'hokm' && uniq.some(c => c.rank === 'K' && c.suit === trump) && uniq.some(c => c.rank === 'Q' && c.suit === trump)) {
      bestList.push({ type: 'baloot', cards: ['K' + trump, 'Q' + trump] });
    }
    return bestList.filter(p => PROJECTS[p.type].modes.includes(mode));
  }


  /* Abnat of a pile of collected cards (one team's tricks). lastTrick = this team took the last trick (+10).
     Returns null for an impossible pile: duplicate cards or a count that is not whole tricks (4 cards each). */
  function pileAbnat(cards, mode, trump, lastTrick) {
    const seen = new Set();
    for (const c of cards) {
      const k = c.rank + c.suit;
      if (!RANKS.includes(c.rank) || !SUITS.includes(c.suit) || seen.has(k)) return null;
      seen.add(k);
    }
    if (cards.length % 4 !== 0) return null;
    if (cards.length === 0 && lastTrick) return null;
    if (cards.length === 32 && !lastTrick) return null;
    return handAbnat(cards, mode, trump) + (lastTrick ? LAST_TRICK : 0);
  }

  /* Every abnat value one team can really end a round with (any subset of the deck, with or without the last trick,
     excluding 0 cards + last trick). Used to reject typing mistakes such as 1 or 161. */
  const _possible = {};
  function possibleAbnat(mode) {
    if (_possible[mode]) return _possible[mode];
    const vals = [];
    for (const s of SUITS) for (const r of RANKS) vals.push(mode === 'hokm' && s === 'S' ? TRUMP_PTS[r] : SUN_PTS[r]);
    let can = new Set([0]);
    for (const v of vals) { const n = new Set(can); for (const x of can) n.add(x + v); can = n; }
    const out = new Set();
    for (const x of can) { out.add(x); out.add(x + LAST_TRICK); }
    return (_possible[mode] = out);
  }
  const isPossibleAbnat = (mode, a) => Number.isInteger(a) && a >= 0 && a <= MODE[mode].total && possibleAbnat(mode).has(a);

  const api = { SUITS, RANKS, SUN_PTS, TRUMP_PTS, LAST_TRICK, MODE, PROJECTS, PROJECT_ORDER, DEFAULTS,
    cardAbnat, handAbnat, pileAbnat, possibleAbnat, isPossibleAbnat, projectPoints, allowedProjects, toPoints, validateProjects, resolveProjects, scoreRound, detectProjects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BalootEngine = api;
})(typeof self !== 'undefined' ? self : this);

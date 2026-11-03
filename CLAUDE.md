# Wafr — project notes for Claude Code

Wafr (وفر, formerly "Wafra") is a personal daily-budget app for the UAE (AED), English + Arabic (RTL).
Owner: Hamad Aljneibi (GitHub 7md2007). Prefers simple English, short answers, step-by-step.

## What it answers
"What can I spend today while protecting upcoming bills?" Home shows **Available today: AED X**,
a bar that fills as you spend, "Next payday in X days", one big **Add expense** button.

## Where the app lives today
- `index.html` — the whole app in ONE file (HTML + CSS + JS, images embedded as base64). ~600 KB.
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — make it an installable full-screen web app (PWA).
- Live: https://7md2007.github.io/wafr/ (GitHub Pages from `main`, root). Owner uses it from the iPhone Home Screen.
- A second copy runs as a Claude artifact (https://claude.ai/artifact/YTvYJZtAUrybXN8J9r8oGw). There, sync and AI
  use the viewer's Claude account via `window.claude.use('db'|'sample'|'user'|'downloads')`. Outside Claude those
  return nothing and the app falls back: data in localStorage only; AI only with the user's own Anthropic API key.

## Data model (localStorage key `wafra.v1` — keep this key, users' data is saved under it)
`{settings, subs, exp:{'YYYY-MM':[...]}, inst, ledger, res}`
- `exp` items: `{id, amt, date, time, m (merchant), cat, brand, note, pay:'card'|'cash', oneoff, res, split:{people:[{id,name,amt,off}]},
  kind:'refund'|'points'|'withdraw', status:'done'|'pending', of (refund→original id), sub, inst, todo, created, src}`
- `ledger`: money in — `type: salary|transfer|earning|extra|repay|adjust` (`salary` has `exp` = expected period start it confirms)
- `res`: planned one-off costs `{id,name,amt,due,status:'open'|'done'|'cancelled'}`
- `settings`: income, savings, incomeMode `manual|salary|irregular`, periodMode `month|custom|payday`, startDay, salaries[],
  opening (mid-period start: `{date,end,amt,save,excl[],at}`), delays[], target, checkin, privacy, autoCfg, textSize, lang, theme.
- Old saved data is upgraded by `migrate()`. Never break old data.

## Money engine — ONE place: `calc(off)`
All numbers go through `calc()`; arithmetic in fils (`fils()`/`unfils()`). Key rules:
- Period bounds: `periodFor()` / `boundsFor()` (salary confirmations and "not yet" delays move boundaries; `opening` creates a mid-period start).
- Spendable funds = income − savings + extra/repay/adjust; refunds count only when `status` is done; withdrawals/points count 0.
- Reserved before the daily amount: unpaid subscriptions + installments due this period (+ overdue) + open planned costs (`resLeft`).
- Bills/installments/planned costs/one-offs/refunds paid today are spread (not charged to today's allowance).
- Real shortfall shown honestly (`shortfall`, `realShort`); never hide reserved bills.

## Other important pieces
- Bank SMS parser `parseBankMsg()` (versioned rules, EN+AR, rejects OTP/promo/balance, foreign currency → review queue). Duplicates → `findDups()` → review queue (`S.queue`), never auto-deleted.
- Shortcut links: `#jp-AMOUNT-SHOP` (opens prefilled form), `#jpa-AMOUNT-SHOP` (auto-save; empty = test), `#jps-<url-encoded SMS>`.
  NOTE: on iPhone, Shortcuts open Safari, whose storage is separate from the Home Screen web app — automatic capture doesn't reach the full-screen app. Real fix = native app (App Intents).
- AI chat proposes expenses as cards; nothing saved until the user taps Add. Daily AI limits in `AI_LIMITS`.
- UI modules were appended in order inside the single file (search for comment banners "Money engine UI", "Transactions", "Import & trust",
  "Calm redesign", "Round 3", "Apple-style interaction layer", "AI outside Claude"). Later modules override earlier views (e.g. `VIEWS.home=homeV3`).
- Design: navy + gold, falcon card image + Dubai skyline header (owner chose these), calm "today-first" layout, springy draggable sheets on phones,
  reduced-motion / reduced-transparency / increased-contrast support, in-app text size.

## Tests
`node tests/finance.test.js` (Playwright; needs `playwright` installed, open index.html). 42 tests must pass:
mid-period start, irregular income, early/late salary, one-offs & reserves, overspend/shortfall, refunds, splits, balance check, cash,
SMS parser, duplicates, subscription price dates, AI proposals, date ranges, leap years, old-data migration, 0.1+0.2.
If the test file path points at `../index.html` it uses this repo's file.

## Where we stopped (Nov 3, 2026)
Done: everything above is live on GitHub Pages. Owner added it to his iPhone Home Screen.
Next (in this order):
1. Split `index.html` into a real project (e.g. Vite + modules: engine, parser, views, styles, i18n) WITHOUT changing behaviour; keep tests green.
2. Prepare Capacitor (iOS) + Codemagic cloud build (owner has NO Mac). Needs his Apple Developer account (was re-applying).
3. Native features to pass App Store guideline 4.2: notifications (evening check-in), widget, Siri/App Intents to add expenses
   (and capture ADIB bank notifications / Apple Pay directly), offline storage.
4. Later: own backend (accounts + sync) and server-side AI with usage limits (AI cost estimate ~AED 0.13/user/month on Claude Haiku 5.5).
Rules: don't invent prices or turn on billing; keep privacy text matching real behaviour; ask before big architecture changes.

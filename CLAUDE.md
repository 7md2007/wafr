# Wafr — project notes for Claude Code

Wafr (وفر, formerly "Wafra") is a personal daily-budget app for the UAE (AED), English + Arabic (RTL).
Owner: Hamad Aljneibi (GitHub 7md2007). Prefers simple English, short answers, step-by-step.

## What it answers
"What can I spend today while protecting upcoming bills?" Home shows **Available to spend today: AED X** with "Spent today AED spent / plan" under it,
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
- Save-up mode (Nov 2026): `settings.carry` = `'spread'` (default: unspent money spread over the rest of the period) or `'save'`
  (unspent money carries over in full: daily = max(spread daily, available − (daysLeft−1) × base), base = (funds − spread items − reserved)/N;
  `savedUp` = daily − base). Overspending is still spread. Toggle: More → My finances → "Money you don't spend". Home shows "Includes AED X you saved up".

## Other important pieces
- Bank SMS parser `parseBankMsg()` (versioned rules, EN+AR, rejects OTP/promo/balance, foreign currency → review queue). Duplicates → `findDups()` → review queue (`S.queue`), never auto-deleted.
- Shortcut links: `#jp-AMOUNT-SHOP` (opens prefilled form), `#jpa-AMOUNT-SHOP` (auto-save; empty = test), `#jps-<url-encoded SMS>`.
  NOTE: on iPhone, Shortcuts open Safari, whose storage is separate from the Home Screen web app — automatic capture doesn't reach the full-screen app. Real fix = native app (App Intents).
- Apple Pay inbox (Nov 2026): Wallet automation → "Get Contents of URL" POST {amount, merchant} to the owner's Cloudflare Worker
  (`inbox-worker/worker.js`, KV binding `INBOX`). App pulls on open/visible (`inboxPull()`), converts currency (`parseMoney`, `fxToAED`),
  then acks (deletes). Config in `settings.autoCfg.inbox {url,key}`. Setup sheet: `inboxSheet()`. Workaround until the native app.
- Receipt scan converts foreign totals to AED (`fxToAED`: USD peg 3.6725, else open.er-api.com, else AI estimate) and writes a description.
- Spending brakes (Nov 2026): `affordSheet()` (price → days of spending + tomorrow's amount via `simulateBuy()`), 2-day wish list
  (`settings.wish`, `wishNudge()`), big-purchase question after saving (`bigBuySheet()`: spread = `oneoff`, from savings = ledger `extra`),
  streak (`streakDays()`, day plans in localStorage `wafr.dayPlans`), home shows `left / plan` and coloured "Tomorrow" line.
- "Your money" screen (Nov 2026, replaces Edit budget + advanced income/period settings): `moneySheet()` — calendar of paydays,
  savings slider, live daily amount. Saves incomeMode `salary`, periodMode month/custom with `startDay = bestAnchor()` (payday that keeps
  cash positive longest) so money is spread evenly. With >1 salary (non-payday mode) `periodIncome` counts each salary occurrence
  (confirmation with `exp === occurrence date` replaces it) and `salaryTarget` matches the nearest salary. Old version: branch `old-version-v1`.
- Bottom bar: Home · Expenses · Subscriptions · More. **Spending is merged into Expenses** (Nov 2026): one page with a range
  picker (`expData()`, `expRangeBar()`: Pay period via `calc(S.off)` + `prev/next`; Today/Week/Month/3 months/Year/Custom via
  `rangeFor()` + `rngPrev/rngNext`), summary + horizontal category bars (`catBars()`), search/filter, owed, needs-details. `#insights`
  and the More → Spending row redirect to `#expenses`. Old page methods (VIEWS home/subs/insights literals, `spendingV3`) removed. Motion polish module (before startup `renderAll()`):
  quick 140ms opacity fade on page change (slide + row stagger removed: laggy on iPhone), tab bounce, counting hero/spent numbers (`moCount`), springy bars (`moBar`); all off with Reduce Motion.
- Monthly needs (pots, Nov 2026): `settings.pots=[{id,type,amt}]` (types in `POT_TYPES`: food, fuel, groceries, shopping, fun, transport, health, family) per pay period. `potOf(e)` (fuel by name via
  `isFuelName`, others by category); pot spending is spread (not today) and the unspent rest is reserved in `calc` (`potRows`, `potRes`).
  Overspending a pot lowers the daily amount. UI: `needsSheet()` (suggests ≈ last 3 periods), `needsHome()` bars on Home, toast after save.
- UAE name list (`UAE_WORDS`, `guessCat()`): cafés, restaurants, delivery apps, petrol stations EN+AR → category, used when typing a
  merchant and for SMS / Apple Pay inbox / shortcut imports.
- AI chat proposes expenses as cards; nothing saved until the user taps Add. Daily AI limits in `AI_LIMITS`.
- UI modules were appended in order inside the single file (search for comment banners "Money engine UI", "Transactions", "Import & trust",
  "Calm redesign", "Round 3", "Apple-style interaction layer", "AI outside Claude"). Later modules override earlier views (e.g. `VIEWS.home=homeV3`).
- Design (Nov 2026, 2nd pass): **Midnight Emerald** dark (charcoal #0C1114 / cards #171F23 / elevated #20322F / accent #7AD0AE /
  text #F5F7F6 / #A9B6B4 / borders #30403F; emerald only for actions, progress, selection and the hero #143A32) + **Emerald & Ivory**
  light (#F7F5EE / #FFFFFF / hero #103D35 / accent #24745F / text #173D35). Both contrast-checked (WCAG AA). Final token layer is at
  the end of the main <style>. No skyline; small transparent mint falcon (`--falcon-img`) in the hero corner. Fonts Inter + IBM Plex
  Sans Arabic bundled in `fonts/` (OFL) — no Google Fonts. Home: compact header (greeting, date · period, status badge) → hero
  ("Available to spend today", "Spent today X / Y" bar, Add expense) → glance row (Tomorrow, Next payday, Can I afford it) → collapsible
  "How it's calculated" card → tiles → needs → coming up → insight → recent. More: profile card + grouped compact rows.
  **Design system** = last block of the main <style> ("WAFR DESIGN SYSTEM"): tokens `--c-*` (bg/surface/surface-2/elevated/text/
  text-2/border/border-strong/accent/hero/track), type scale `--fs-*`, radii `--r-*`, spacing `--sp-*`; shared components (page header,
  section header, card, stat card, list row, bars, buttons, chips, range bar). Legacy variable names map onto these tokens.
  **Form system** (Nov 2026, after the design system block): compact 48px inputs, one big amount per form, pill category picker
  ordered by recent use (`catOrder()`), readable date label over native pickers (`enhanceDates()`/`dateText()`, fixes RTL dates),
  stepper for installment count (`cntStep`), compact installment preview, sticky actions. Expense: Amount → Category → Place
  (optional) → Date; "+ Another" (save & reopen), draft kept 15 min if dismissed (`wafr.expDraft`), double-submit guard.
  Installment: store/deposit/fee/notes under More options. Subscription: amount + frequency on one row.
  `yourMoneySheet()` = Your money screen (was a duplicate `moneySheet` name that broke "Salary received").
  Swipe back (Nov 2026): only on full-screen sub-pages opened from More (Installments, Ask…), back to where they were opened; main
  tabs never swipe. Both languages — English from the LEFT edge, Arabic from the RIGHT edge. Pages replace the
  history entry (`navTo()`), so the iPhone's own back-swipe has nothing to go back to; Wafr keeps a stack `NAVST` of {view, scroll}.
  While dragging the previous page is rendered underneath (`bkUnder()`); release switches instantly (`navBack()`, `MO.skip` = no
  page animation) and restores the scroll position. No back buttons (owner's choice).
  Before-redesign copies: branches `old-version-v2` (navy/gold), `old-version-v3` (first emerald), `old-version-v4` (before unification),
  `old-version-v5` (before form redesign).

## Performance rules (Nov 2026 audit — keep these)
- Sheets: open/close run as Web Animations on transform/opacity (`shAnim`, compositor); the JS spring is only for finger drags.
  The scrim is its own layer (`#ovscrim`, opacity). Never set CSS custom properties on #overlay/html per frame (restyles every child);
  never measure layout per frame (`SH.h` is measured once per animation/drag).
  Swipe-down: claim the gesture on the FIRST touchmove (iOS commits to native scrolling otherwise), one transform write per frame
  (`shSetSoon`), release finishes with `shAnim` at the finger's speed; `.sheet .sh-scroll{overscroll-behavior-y:none}`.
- Bars animate with `transform: scaleX` (`moBar`), never `width`.
- Date/number formatters are cached (`_DFC`, `_NF0/_NF2`); creating Intl formatters per row was >50% of render time.
- `renderNav` only touches the DOM when its markup changed (`setHTML`).
- iPhone keyboard: `kbSync()` (visualViewport) lifts the open sheet above the keyboard so Save stays visible.
- Form controls: one segmented look (`.seg`/`.seg2` share the track+thumb style), one big amount per form at `--amt-h` (60px),
  inputs `--in-h` (48px), 2-column rows `align-items:end`. Block "FORM CONSISTENCY" at the end of the main <style>.

## Tests
`node tests/finance.test.js` (Playwright; needs `playwright` installed, open index.html). 42 tests must pass:
mid-period start, irregular income, early/late salary, one-offs & reserves, overspend/shortfall, refunds, splits, balance check, cash,
SMS parser, duplicates, subscription price dates, AI proposals, date ranges, leap years, old-data migration, 0.1+0.2.
If the test file path points at `../index.html` it uses this repo's file. (47 tests since save-up mode.)

## Where we stopped (Nov 3, 2026)
Done: everything above is live on GitHub Pages. Owner added it to his iPhone Home Screen.
Next (in this order):
1. Split `index.html` into a real project (e.g. Vite + modules: engine, parser, views, styles, i18n) WITHOUT changing behaviour; keep tests green.
2. Prepare Capacitor (iOS) + Codemagic cloud build (owner has NO Mac). Needs his Apple Developer account (was re-applying).
3. Native features to pass App Store guideline 4.2: notifications (evening check-in), widget, Siri/App Intents to add expenses
   (and capture ADIB bank notifications / Apple Pay directly), offline storage.
4. Later: own backend (accounts + sync) and server-side AI with usage limits (AI cost estimate ~AED 0.13/user/month on Claude Haiku 5.5).
Rules: don't invent prices or turn on billing; keep privacy text matching real behaviour; ask before big architecture changes.

## Baloot score keeper (Nov 8, 2026) — separate page, does not touch Wafr
- `baloot/index.html` (Arabic RTL, sky-blue/turquoise/white/peach) + `baloot/engine.js` (pure scoring engine). Live at /wafr/baloot/.
- Flow: صن/حكم → trump suit (Hokm only) → buyer لنا/لهم → المشاريع sheet (only projects valid for the mode) → abnat for لنا or كبوت → confirm.
  Mode/trump/buyer remembered (`baloot.v1`); projects never carried to the next round.
- Rules in engine: Sun 130 abnat = 26 pts (÷5), Hokm 162 = 16 (÷10, a 5 rounds down; 86–76 → 9–7). Projects Sun سرا4/خمسين10/مية20/أربعمية40,
  Hokm سرا2/خمسين5/مية10/بلوت2 (4 aces in Hokm = مية). Strongest project cancels the other team's; equal type → user picks; بلوت never cancelled
  and stays with its owner. Buyer must beat the other team (abnat + projects); failing gives the other team the whole round + projects.
  Kaboot 44 / 25. Tie rule is a setting (split / buyer loses). Doubling (دبل/ثري/فور/قهوة) not implemented yet.
- Photo scan: AI reads visible cards only → engine `detectProjects()` → user picks owner for each; or "our tricks" photo → abnat + asks about الأرض.
- Tests: `node tests/baloot.test.js` (46, plain node).

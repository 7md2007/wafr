# حاسبة البلوت — Baloot score keeper

An Arabic (right-to-left) Baloot score keeper that works on the iPhone. You can type the score or scan a photo of your team's tricks. It lives in this repo next to Wafr and does not touch Wafr.

| File | What it is |
|---|---|
| `index.html` | The whole app: screens, styles and logic. |
| `engine.js` | The scoring rules. Plain code, no AI. Every number comes from here. |
| `vision.js` | Card reading: finds card regions, fixes bad light, straightens tilted cards, crops, merges the AI answers and runs checks. |
| `synth.js` | Draws test photos where the right answer is known. |
| `config.js` | Public settings. Holds the AI server address and **no secrets**. |
| `ai-worker/` | The AI server (Cloudflare Worker). The Anthropic key is stored on the server only. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` | Make it a Home Screen app that also works offline. |

## How a scan works

The AI reads each card, but it never does the maths. `engine.js` does all the scoring.

1. **Your phone does the local work** (about 0.2–0.6 s on a desktop CPU):
   - It finds the card regions in the photo.
   - It corrects dark, yellow or uneven light when needed. Clear photos skip this step.
   - It chooses zoomed crops.
2. **Two AI reads run at the same time.** One reads the whole photo; the other reads the zoomed crops.
3. **The two answers are merged:**
   - Each card is counted once.
   - The deck rule applies: one of each card.
   - Duplicates are flagged and never renamed.
   - A local red/black ink check runs on each card.
4. **Unsure cards are read again:**
   - Each one is read as a pair: the photo as taken, plus a corrected copy.
   - A tilted card is flattened to a straight-on view (`cardQuad` / `warpCard`).
   - The new reading is used only if the AI is at least 85% sure.
5. **Nothing uncertain is hidden.** Unsure cards are marked, and the score is blocked until you confirm them.

Reading the same photo again does not call the AI again.

## Run it on your computer

```bash
npx serve .          # then open http://localhost:3000/baloot/
```

Opening `baloot/index.html` straight from the disk also works, but the offline mode (service worker) needs `https://` or `localhost`.

## Tests

You need Node 20+ and Playwright installed: `npm i --no-save playwright && npx playwright install chromium`.

```bash
node tests/baloot.test.js            # scoring rules (80)
node tests/baloot.examples.test.js   # 36 worked examples, checked by hand (--write rebuilds SCORING-EXAMPLES.md)
node tests/baloot.props.test.js      # 25,000+ random rounds checked against rules that must always hold
(cd baloot/ai-worker && npm ci) && node tests/baloot.worker.test.mjs   # AI server, with a fake Anthropic API
node tests/baloot.vision.test.js     # card reader without AI: regions, light correction, perspective, merge logic
node tests/baloot.ui.test.js         # the app on a phone-size screen (fake camera, AI answers faked)
node tests/baloot.perf.js            # speed with iPhone screen emulation and a 1×/4×/6× slower CPU
```

GitHub Actions runs all of these on every push that changes `baloot/` (`.github/workflows/baloot-tests.yml`).

### Real AI accuracy (uses API credit, not part of CI)

```bash
ANTHROPIC_API_KEY=sk-ant-… node tests/baloot.ai-eval.js --runs 2
# or through your deployed server:
BALOOT_AI_URL=https://baloot-ai.<you>.workers.dev/read BALOOT_ORIGIN=https://<your site> node tests/baloot.ai-eval.js --runs 2
```

What it uses:

- **Test photos:** 29 photos the app was never tuned on (clear, overlapping, covered, dark, yellow light, side light, blurry, far, tilted, green/wood/white tables, all 32 cards).
- **Your own photos (optional):** put them in `tests/vision-data/` as `x.jpg` plus `x.json` = `{"cards":["AS","10H",…]}`. That folder is git-ignored.

What it prints, per group (clear / overlap / low light / far / real):

- recall
- rank accuracy
- suit accuracy
- complete-image rate
- false cards
- duplicates
- time
- stability between runs

Every failed image is saved to `tests/ai-eval-out/` (also git-ignored), so you can turn it into a regression case.

## Put it online

The app is static files. The only secret is the Anthropic key, and it stays on the AI server.

### 1. The AI server (Cloudflare Worker)

```bash
cd baloot/ai-worker
npm ci
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY      # paste the key; it is stored encrypted on Cloudflare, never in git
# edit wrangler.jsonc → "ALLOWED_ORIGINS": your site address(es), comma separated
npx wrangler deploy                            # prints https://baloot-ai.<you>.workers.dev
```

Then put that address in `baloot/config.js`: `aiUrl: 'https://baloot-ai.<you>.workers.dev/read'`.

How the server protects your key and your credit:

- **Only your site can call it.** Requests from any other website get "403".
- **Request limits:**
  - 20 reads per minute per visitor.
  - At most 8 images per call.
  - Images only, at most 14 MB per call.
- **Nothing is kept.** No photo is stored. The key is never sent back to the browser.
- **Model settings** are `MODEL` and `EFFORT` in `wrangler.jsonc`. The defaults are `claude-opus-5-5` with effort `low`.
  - For faster, cheaper reads, set `MODEL` to `claude-sonnet-5-5`.
  - Run the accuracy test before and after any change.
- **Refusals:** if the model declines a request, the server retries it on the recommended model (`fallbacks: "default"`).

Prefer GitHub Actions? Use `.github/workflows/baloot-ai-deploy.yml`. It is manual only and needs three repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ANTHROPIC_API_KEY`

**Spending limit:** in the Anthropic Console you can set a monthly spend limit on the key. Do this before sharing the link.

### 2. The website

Pick one:

- **Cloudflare Pages** (works with a **private** repo on the free plan):
  1. Dashboard → Workers & Pages → Create → Pages → Connect to Git → choose the repo.
  2. Build command: *(none)*. Output directory: `/`.
  3. The app is at `https://<project>.pages.dev/baloot/`. Every push to the chosen branch redeploys.
- **GitHub Pages:**
  - Already on for this repo (`main`, root). After merging, the app is at `https://7md2007.github.io/wafr/baloot/`.
  - GitHub Pages on a *private* repo needs a paid GitHub plan.

Add the site address to `ALLOWED_ORIGINS` in `ai-worker/wrangler.jsonc`, then redeploy the worker.

## Add it to the iPhone Home Screen

1. Open the site in **Safari**.
2. Tap the Share button, then **Add to Home Screen**, then **Add**.
3. Open it from the new icon. It runs full screen.

What works offline:

- Scores and history are saved on the phone (`localStorage`).
- Scoring, history and typing scores by hand all work with no internet.
- Scanning photos needs internet.

The first time you scan, allow the camera when iPhone asks.

## Privacy

| What | Where it goes |
|---|---|
| Scores and history | Stay on your phone only. |
| Photos | Sent to your AI server, which forwards them to Anthropic to read the cards. The server does not store them. |
| API keys | Never in this repo, never in the website files. The server key is a Cloudflare secret. The optional personal key (⋯ settings, used only when no server is set) stays in that phone's storage. |
| Your test photos | `tests/vision-data/` is git-ignored. |

## Limits (honest)

- **No custom-trained model.** Cards are read by Claude (a vision AI) plus local image analysis. Training our own model would need thousands of labelled real photos, and we don't have them.
- **Real-AI accuracy has to be measured with your key.** Run `tests/baloot.ai-eval.js` and use its numbers. The CI tests use fake AI answers, so they check the logic, not the AI.
- **Speed was measured with an emulated iPhone screen and a slowed desktop CPU, not a real iPhone.** The real phone, network and model time will differ.

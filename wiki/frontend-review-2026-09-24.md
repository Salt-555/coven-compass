# Frontend review — 2026-09-23/24 (5 read-only reviewers)

Five parallel reviewers: mobile screenshots+vision, desktop screenshots+vision, code cleanliness,
accessibility/interaction, funnel cohesion. Verdicts converged hard. Full transcripts:
`~/.hermes/cache/delegation/live/deleg_ee426ead/task-{0..4}.log`

## Fixed in this pass (all verified live)

| # | Finding | Source | Fix |
|---|---------|--------|-----|
| 1 | Spell planner advertised as chart-aware ("sorted for your element, timed to your power windows") but shipped an alphabetical list — affinity.js was dead code | cohesion (blocker), code | Wired `profile.js` + `affinity.js` into spells.html: element-sorted dropdown, power-window line from real ephemeris. Verified: air Sun → clarity/communication/justice/new beginnings/travel safety/wisdom, "Moon enters Gemini on October 1" |
| 2 | Paid buyer with cleared storage silently dumped on the sales page (in-app browser storage, Private Mode, new phone) | a11y (blocker) | `gate.js` → `/enter.html?gate=1&next=<path>`; /enter explains the lock, offers support, returns to the intended page |
| 3 | Cold landing had no route into the product for buyers (entry link only inside `#result`) | cohesion (blocker) | Always-visible "Bought it already? Enter your kit →" |
| 4 | `/success` showed a purchase receipt to anyone with the URL | cohesion (blocker) | Two states: verified receipt vs "We couldn't confirm a purchase". Purchase pixel fires only on verified |
| 5 | Typing an exact city without tapping a suggestion was a hard stop | a11y (major, blocked funnel) | `resolvePlace()` in both forms falls back to the best match and shows "Using Denver, Colorado, US" |
| 6 | Hub emoji icons semantically wrong (star-and-crescent for chart, game controller for tarot, flashlight for spells) | mobile + desktop (blocker/major) | Inline gold SVG line icons, uniform 36px box |
| 7 | Chart page: 80,000px document, no sticky chrome; `#totop` shipped in vendor CSS but never activated | mobile, a11y | Sticky tools bar, working back-to-top, 18px gap before TOC, prose capped at 66ch |
| 8 | Vendor `reading.css` `.toc` rules left the TOC flush-left while everything else is centred | desktop | `.toc{margin:20px auto!important}` — verified 233px/248px gutters |
| 9 | iOS/WebView zoom-on-focus from sub-16px inputs (spells 13–14px, tarot 12.8px) | a11y | All text/date/textarea fields ≥16px |
| 10 | Tap targets under 44px (suggestion rows 38px, tool buttons 36px, "Your kit" 22px, close × 13×22) | both | ≥44px min-height throughout; autocomplete rows 44px with 8px gaps |
| 11 | Contrast failures (placeholder 3.89:1, footer 3.70:1, mini-note 3.54:1, hub recast 3.42:1) | both | Explicit placeholder colour `#9a92ad`, footer/recast raised to `#8f86a3` |
| 12 | Checkout modal: only exit was a 13px ×, no Esc, no backdrop close, no dialog semantics, background scrolled | a11y | 44px close, Esc + backdrop close, `role="dialog"`/`aria-modal`, body scroll lock |
| 13 | Checkout failure used a blocking native `alert()` while every other error used the page's error line | code | Inline error with a support address |
| 14 | `alert()`→ 9.6 MB of build-source assets shipped in `public/` (card-data.json, deck.js, 312 card webps, b64 intermediates) | code | `git mv` → `assets-src/tarot/`; public 15 MB → 5 MB; verified 404 live |
| 15 | `_headers` "comment" block is actually the live COOP/COEP rules — one tidy-up silently kills the tarot AI | code | Explicit DO-NOT-COMMENT warning; dead `/*.wasm` rule removed |
| 16 | Gated pages crawlable; no favicon/OG on app pages; spells title was just the brand | code | `X-Robots-Tag: noindex` (wildcard patterns — extensionless routes), meta fallbacks, favicons, titles aligned |
| 17 | Landing had two identical "$10" CTAs ~600px apart | desktop | Wheel CTA demoted to an in-page anchor; one primary button |
| 18 | og:url/og:image still pointed at the coven-v2 test host | code | Pointed at coven-compass.allmind.biz, twitter tags added |

## Decisions made where reviewers conflicted
- **Spells legacy styling**: code reviewer called the styling drift "fair to leave" (byte-for-byte
  port); cohesion reviewer called the chart-awareness claim a blocker. Resolved by *delivering* the
  feature (affinity wiring) rather than watering down the claim. Restyle still open (backlog).
- **Reading measure**: visual reviewers wanted 65ch prose *and* wider desktop chrome. Capped prose
  at 66ch (561px) only; chrome stays 800px. Revisit if the reading still feels dense.
- **COEP `credentialless` on `/*`**: flagged as a *hypothesis* for embedded-Stripe failures inside
  in-app browsers. Not touched — it is load-bearing for wllama's `crossOriginIsolated`, and the real
  in-app failure is already solved by hosted-checkout routing.

## Backlog (not done — needs a call)
1. **Extract `/js/birthform.js`** — the birth form (autocomplete, tz resolution, cast) is duplicated
   in index.html and chart.html and already diverged (noon hint, validation). Medium effort.
2. **Desktop layout**: landing shell is 520px on a 1440 screen (~60% dead space); entry form fields
   full-width for 8-character values; upsell panel same width as the free tool. Proposal: 640–720px
   shell, date+time side by side, wider upsell.
3. **Tarot empty state** (both visual reviewers, major): ~480px void before first draw, no card-slot
   placeholders, PAST/PRESENT/FUTURE labels 9.6px and hidden, stray gold progress bar with no label,
   no brand and no back-to-kit nav on the page. Also: the 530 MB first-draw download is warned about
   on /success but not on the tarot page itself.
4. **Spells restyle to shared tokens**: purple CTA gradient vs the gold used everywhere else, fonts
   via blocking `@import`, `--ink:#0D0A1A` vs canonical `#0d0a14`.
5. **Copy standardisation**: landing teaser still says "Spell designer aligned to your chart's
   element" (now true, but rename to Spell Planner); "Coven" vs "kit" for one destination; the same
   action named "Reveal my free star chart" / "Enter my birth details" / "Cast my chart".
6. **A11y round 2**: `for=`/`id` label associations on spells + tarot fields, `aria-live` on status
   and error lines, `:focus-visible` rings on inputs, remaining contrast (`--light-muted` 4.28:1,
   `.badge-pending` 3.23:1), `.sp-label` 9px micro-labels.
7. **Terms/privacy**: disclose the ~530 MB first-draw download and the classic-readings fallback.
8. **Empty states**: `filterSupplies('zzzz')` renders nothing (should say "no matches").
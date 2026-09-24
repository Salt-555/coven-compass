# Storefront dossier — coven-compass.allmind.biz (2026-09-24)

Baseline for storefront/sales-page work. Deployed version c1cf4a37. Sources: full source read of
`public/index.html`, `public/js/minichart.js`, live geometry measurement at 390×844 (iPhone UA) and
1440×900, full copy dump.

---

## 1. The two states

### Cold (390×844) — page height **844px, exactly one screen. No scroll at all.**
| Element | y | height |
|---|---|---|
| brand "Coven Compass" | 24 | 32 |
| sub: "Your chart is already written. Cast it free — it stays on your device." | 60 | 34 |
| form (3 fields) | 122 | 388 |
| **CTA "Reveal my free star chart"** | **418** | **50** |
| micro "No card. No email. Instant. Everything stays on your device." | 480 | 30 |
| "Bought it already? Enter your kit →" | 536 | 40 |
| footer (Privacy · Terms · Support) | 616 | 36 |

Fields: date 48px, time 49px, place 46px — all ≥44px. CTA is above the fold, no scroll to reach it.

**The cold page makes no case.** A visitor from a Meta ad sees: brand, two lines, three personal
fields, a button. There is **no social proof, no explanation of the payoff, no sample, no objection
handling, no "what $10 gets you"** before the ask. The only supporting line ("No card. No email.
Instant…") sits *below* the button. Deliberate speed, but it is the single largest open question in
the funnel.

### Post-cast (390×844) — page height **2054px**
| Block | y | height |
|---|---|---|
| mini chart (Big Three + essence + 6-item teaser) | 186 | 422 |
| natal wheel (SVG 324 + caption + CTA) | 630 | 467 |
| — wheel CTA "Unlock the full reading — $10 ↓" | 1057 | **19** (text link) |
| upsell card (h2 + 3 deliverables + price + button) | 1119 | 779 |
| price line "$10 — one time. Yours forever…" | — | — |
| **buy button "Get everything — $10"** | **1715** | **52** |

**Scroll from the top of the cast result to the buy button: ~951px (1.1 screens).** The only
mid-scroll affordance is a 19px-tall text link.

### Desktop (1440×900) — shell **520px wide, centred at x=453 → 467px dead space each side (~65%)**
Page 1918px. mini chart, wheel and upsell are all 520px. The wheel — the strongest visual asset —
renders at 520px in a 1440px window.

---

## 2. Current copy (verbatim, post-cast)

- brand: `Coven Compass`
- sub: `Your chart is already written. / Cast it free — it stays on your device.`
- field labels: `Birth date` · `Birth time (local clock)` · `Birth place` — plus `Don't know your birth time?`
- CTA: `Reveal my free star chart`
- micro: `No card. No email. Instant. Everything stays on your device.`
- entry: `Bought it already? Enter your kit →`
- essence: `Your Gemini Sun carries the loudest voice in this chart — but it only speaks fully with your Pisces Moon and Libra Rising beside it.`
- teaser (real numbers from the render): `23,166 words — every one about your chart` · `27 planetary aspects, interpreted in full` · `204 dated forecasts for your year ahead` · `Your complete natal wheel, house by house` · `AI tarot readings woven through your Gemini nature` · `Spell designer aligned to your chart's element`
- wheel caption: `Your full natal wheel. Every line is an aspect of you — the reading below the surface is where it gets personal.`
- wheel CTA: `Unlock the full reading — $10 ↓`
- upsell h2: `Unlock the rest of your chart`
- deliverables: `Your full chart, interpreted` + 160 chars · `Infinite AI tarot readings` + 150 chars · `Spell planner + tracker` + 150 chars
- price: `$10 — one time. Yours forever. No subscription. Ever.`
- buy: `Get everything — $10`
- links: `Not you? Start over` / `Already unlocked? Enter →`
- footer: `Privacy · Terms · Support` · `© 2026 ALLMIND`

---

## 3. Mechanics that work (do not break these)

1. **Two-step funnel: free real cast → upsell.** The free result is not a fake taste — it runs the
   paid engine's own render to get true counts (23,166 words / 27 aspects / 204 transits) and draws
   the paid wheel with the same code. Strongest asset on the page.
2. **Zero-friction entry**: no card, no email, no account, all client-side; 3 fields, all ≥44px, CTA
   above the fold on a phone.
3. **In-app-browser handling**: UA sniff → hosted Stripe redirect for Instagram/FB/TikTok webviews,
   embedded modal otherwise.
4. **Honest offer framing**: one-time price, no subscription, no fake countdown/urgency anywhere.
5. **Verified purchase path**: session verified against Stripe before unlock and before the Purchase
   pixel fires.
6. Returning visitor with a cached profile auto-casts to their mini chart.

## 4. Friction and gaps (the work)

**Structural**
- F1. ~951px between payoff and buy button; the wheel block sits between them.
- F2. The only mid-scroll CTA is a 19px text link (should be a ≥44px button).
- F3. Cold state offers no proof, no payoff preview, no social proof before asking for birth data.
- F4. Desktop wastes ~65% of the viewport; no responsive upgrade of the funnel.
- F5. No sticky CTA after the cast on mobile.

**Copy / offer**
- F6. Upsell h2 promises "the rest of your chart" but the stack is chart + tarot + spell planner.
- F7. Two names for one product: "Spell designer" (teaser) vs "Spell planner + tracker" (upsell).
- F8. "Infinite AI tarot readings" — unverifiable; and the privacy/on-device angle (the real trust
  hook) is buried mid-paragraph in deliverable 2.
- F9. Deliverable bodies are ~160-char paragraphs ×3 → a text wall on mobile.
- F10. No FAQ / objection handling (subscription? account? unknown birth time? refund?).
- F11. No "what happens after you pay" reassurance (instant access, email link, works on any device).
- F12. No social proof of any kind — no buyer count, no testimonial, no rating.
- F13. No refund/guarantee line.
- F14. Teaser list order leads with words/aspects; the wheel and spells (abstractions) precede the
  tarot (most vivid).

**Measurement**
- F15. Events: PageView, InitiateCheckout, Purchase only. No scroll-depth, no form-start, no
  view-of-offer event — we cannot yet tell where storefront visitors fall out.
- F16. No Conversions API / server-side events → iOS signal loss on a mobile-heavy audience.
- F17. Stripe dashboard still pending: abandoned-cart recovery emails OFF, display name not set to
  "Coven Compass" (checkout page reads "Allmind").

## 5. Funnel numbers — INCOMPLETE, needs approval
Last 100 sessions on the Stripe account: **80 coven sessions — 17 paid, 13 open, 50 expired.**
Caveat: several of today's sessions are my own verification runs (the checkout API was exercised
repeatedly), so the paid rate cannot be trusted as-is. A day-by-day breakdown with buyer emails was
blocked mid-run pending approval; re-run before we baseline anything.

## 6. Candidate levers (ranked)

1. **Shorten payoff→pay** (F1/F2/F5): reorder to mini chart → offer card → optional "see your full
   wheel" toggle, and/or sticky mobile CTA. Est. 951px → ~350–450px.
2. **Use the desktop viewport** (F4): 640–720px shell; two-column post-cast (chart/wheel left, sticky
   offer card right).
3. **Make the case on the cold page** (F3/F12): proof strip built from numbers we already compute,
   real buyer count, one or two real quotes if available. Must not push the form below the fold.
4. **Copy surgery** (F6–F9, F11–F14): single product name, honest framing, scannable bullets, surface
   privacy + instant-access + works-on-any-device next to the button.
5. **FAQ block** (F10) below the fold — costs nothing on the cold page.
6. **Instrument the storefront** (F15/F16): scroll depth, offer-view, form-start, and CAPI mirroring.
7. **Stripe dashboard** (F17): cart recovery + display name — two toggles, immediate effect on the
   measured funnel.

## 7. Constraints to respect
- No fake urgency/scarcity (standing rule). Honest scarcity only.
- Grandfather existing buyers on any model change (standing rule).
- Storefront-first, budget-first; downloadable/ownership framing over SaaS framing.
- Anything we claim must ship — the affinity.js episode is the cautionary tale.
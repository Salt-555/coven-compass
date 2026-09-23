# Coven Compass — Funnel Review (2026-09-23)
*Veteran direct-response review. Everything below was verified by walking the live funnel on desktop and mobile (390px + Instagram in-app UA spoofing) on 2026-09-23, plus code review of hub/chart/spells/tarot. Golden path: 1990-06-15, 14:30, Denver → Sun Gemini / Moon Pisces / Libra rising, 23,166 words, 27 aspects, 204 transits.*

---

## 0. The one-paragraph verdict

The product is better than the funnel deserves. The free chart is a genuinely excellent teaser (real engine, real wheel, personalized stats), the app delivers on the promise, and the $10 price is right for a no-name brand. But the funnel is flying **blind and leaky**: no Meta pixel or Conversions API fires anywhere on the site (verified — only a Cloudflare beacon loads), there is no email capture before purchase, the success page actively scares buyers about the tarot reader, the unit economics are under water ($10 AOV vs $10.20 CPA ≈ $9.40 net after Stripe), and the checkout fix that shipped 09-23 is unverified against real in-app traffic. Do not spend another dollar on ads until items 1–3 of the action list are done.

---

## 1. Stage-by-stage review

### Stage 1 — Ad → Landing (first 3 seconds)

**What works**
- Landing loads in ~130ms TTFB, 5.8KB compressed HTML; the page cannot be the bounce problem on speed.
- Copy has real voice: *"Your chart is already written. Cast it free — it stays on your device."* The "already written" fatalism + on-device privacy promise is exactly the right positioning against astrology SaaS, and it echoes well in an ad.
- Gold-on-black Cinzel serif aesthetic is premium and matches the ads' mystical mood.

**What leaks (ranked)**
1. **There is nothing below the fold and nothing beside the form.** On mobile the entire bottom ~45% of the hero viewport is empty black — no product image, no chart wheel preview, no proof, no reassurance. A cold Instagram visitor is asked to hand birth data to an unknown brand that shows zero evidence it produces anything. This is the biggest landing-side bounce driver.
2. **Zero social proof.** No testimonial, no counter, no rating. You have 33 real buyers — the page uses none of them. (Never fabricate; but "N charts cast this week" costs an hour and is honest the moment it's true.)
3. **No trust furniture at all:** no privacy policy or terms links, no footer, no favicon, and the browser tab title literally reads "🐴 Coven Compass" (a horse emoji — almost certainly a placeholder that shipped). Cold visitors read these micro-tells as "sketchy ad page," and Meta's ad review will eventually read them the same way. Also: **no OG tags on the page at all** (verified) — any organic share or buyer forwarding the link previews as a dead link.
4. **Tagline and icons are too low-contrast.** The one true differentiator ("stays on your device") is the least legible element on the page; the calendar/clock icons are dark-on-dark.
5. **No microcopy under the CTA.** The #1 hesitation at a free-but-$10-later funnel is "is 'free' bait?" One line — "No card. No email. Instant." — answers it.
6. **Birth-time friction with no escape hatch.** "(LOCAL CLOCK)" is jargon; there's no "I don't know my exact time" path. Defaulting silently to 12:00 produces wrong risings, and a wrong rising destroys faith in the paid reading.

### Stage 2 — Free chart (this is your best asset)

**What works**
- Fast, real, and personal: Sun/Moon/Rising in seconds, the *actual rendered natal wheel* from the paid engine, and copy that uses the visitor's own chart: *"Your Gemini Sun carries the loudest voice in this chart — but it only speaks fully with your Pisces Moon and Libra Rising beside it."*
- The deliverables block flexes *real computed numbers* — "23,166 words — every one about your chart," 27 aspects, 204 dated forecasts. This is the honest version of social proof: the demo itself proves the product. Keep this.
- Returning visitors skip the form entirely (cached profile) — good for ad frequency 1.13 repeat exposures.

**What leaks**
1. **The visitor hits the value peak and is never asked for anything but $10.** No email capture anywhere pre-purchase. Every one of the ~70 people who engaged but didn't buy is permanently unrecoverable — no list, no retargeting (see pixel finding below). This is the single most expensive omission in the funnel.
2. **The buy CTA sits below the fold** on mobile (~1825px page on an 844px screen) with no sticky option. The moment of maximum desire is the wheel reveal; the button is two scrolls later.
3. **"$27 $10" anchor reads as a fake discount** on a brand with no proof. You have a better, honest anchor: an astrologer charges $40+ for a natal reading, or apps charge $9.99/mo to *rent* what you *own*. Use the rent-vs-own frame, not a struck-through price.
4. No event fires when the chart casts. This is your ViewContent/Lead moment and today Meta never hears about it.

### Stage 3 — Checkout (the break)

**What works**
- The webview detection is correctly implemented (verified in code and live: Instagram UA → `POST /api/checkout?mode=hosted` → 302 to a live `checkout.stripe.com/c/pay/cs_live_…` hosted page; normal UA → embedded Stripe modal). The hosted page works and collects email first.
- Embedded modal for real browsers is the right default; "Opening checkout..." button state prevents double-taps.

**What leaks**
1. **The fix is 0-day old and unverified with real traffic.** The 17-sessions/0-attempts break (09-19→09-23) plausibly = embedded iframe dead in in-app webviews, and the redirect now works in emulation — but nobody has completed a real in-app purchase end-to-end (payment → webhook → email → hub) since the change. Until one does, assume the break persists.
2. **"Paying Allmind"** — the hosted Stripe page header shows the account name "Allmind," not "Coven Compass." A stranger who's never heard of either sees a mismatched merchant name at the card field. Rename the Stripe display name today (Settings → Public details); it's free trust.
3. **Embedded modal is 490px wide** — fine on desktop, but on the minority real-browser mobile users it's cramped. Minor.
4. **~44 abandoned checkouts (70 IC − 26 purchases) exist and Stripe's built-in abandoned-cart recovery emails are apparently not part of the plan.** Those abandons had email typed in (hosted flow) or reachable (embedded). Free money not being collected.
5. No `InitiateCheckout` pixel event on modal open / hosted redirect — Meta's "70 initiate checkouts" number is historical; the current page cannot produce it.

### Stage 4 — Post-purchase (success → hub → chart / tarot / spells)

**What works**
- Success page ("Welcome to the Coven.") has a direct **"Enter your kit →"** button — no dead-end, no forced inbox wait. Good.
- Hub is clean: three cards, personalized "Welcome back — Sun in Gemini," recast escape hatch.
- `/chart` renders the full ~23k-word reading with TOC, stats line ("23,166 words, about N printed pages"), and print-to-PDF. This is a legitimately $30+ deliverable rendered on-device for $0 marginal cost. It is the product. It delivers.
- `/spells` sorts 30 intentions by the user's element with an "Aligned with your Sun" badge, power-window line, and a persistent spell log. On-brand and sticky.
- `/tarot` engineering is genuinely careful: lazy LLM boot on first draw, OPFS caching, 90s model rest to avoid phone OOM, 75s stall watchdog, static-reading fallback. The Three.js card scene with muted gold on near-black is ad-quality footage waiting to be screen-recorded.

**What leaks**
1. **The success page leads with fear:** *"The tarot reader downloads a small AI model the first time (~530 MB, cached after). Best in a regular browser, not an in-app one."* Your buyers are ~100% mobile in-app users. You are telling 100% of buyers, at the moment of maximum post-purchase endorphin, that one third of what they bought "may not work here." That line manufactures regret and refund risk. Invert it or remove it.
2. **The tarot's empty state looks unfinished** — two-thirds of the mobile viewport is blank below the draw button; no card backs, no spread geometry, a stray divider floating over nothing. First open reads "broken," not "ceremonial." Show three card backs pre-draw.
3. **530MB on cellular in an in-app browser is hostile** to exactly the buyer you have. The fallback static readings exist — the success page should push the instant classic reading as the default experience and the LLM as an optional "deeper reader" upgrade on Wi-Fi, not the reverse.
4. **The fulfillment email promises a bookmark that only half-exists.** Access is a localStorage profile; the emailed link on a new device just lands on the marketing page (profile gate redirects). It accidentally *works* (re-cast = access), but the email should say what's true: "open coven-v2.allmind.biz on any device, cast your chart, everything unlocks."
5. **No LTV layer exists.** No email sequence, no back-end, no second purchase, no retargeting audience beyond (currently nonexistent) pixel data. Stripe holds 33 buyer emails right now and nothing has ever been sent to them. At $9.40 net per buyer vs $10.20 CPA, the funnel loses money on every acquisition and has no mechanism to earn it back. This isn't a nice-to-have; it's why the kill line ($10 AOV) is being hit.

---

## 2. Prioritized action list (ruthless order)

| # | Action | Effort | Expected impact |
|---|--------|--------|-----------------|
| 1 | **Install Meta Pixel + Conversions API.** PageView on landing, ViewContent on chart cast, InitiateCheckout on buy click / hosted redirect, Purchase on success page + server-side from the Stripe webhook. | S | Everything else depends on it: real funnel numbers, Purchase optimization, retargeting audiences, lookalikes. Highest leverage per hour in the whole business. |
| 2 | **Verify the hosted-checkout path with one real in-app purchase on a physical phone** (IG browser): pay $10, confirm webhook → email → hub, and confirm the Stripe session's success URL returns properly. Don't scale spend until this is proven. | S | Directly addresses the 17-opened/0-paid break; protects all future spend. |
| 3 | **Rewrite the success page.** Lead with the win ("Enter your kit →"), describe the tarot honestly and positively ("the deep reader fetches its AI once — do it on Wi-Fi; instant readings work everywhere"), push the classic reading as default. | S | Kills post-purchase regret/refund risk; raises product perceived-value at the moment that drives word of mouth. |
| 4 | **Turn on Stripe's abandoned-checkout recovery emails** (Dashboard → Checkout settings) and fire an `InitiateCheckout` event. | S | The ~44 recent abandons + all future ones get automated recovery for free. Fastest incremental revenue available. |
| 5 | **Add optional email capture after the free chart casts** ("Want this chart emailed? — it's your backup key") feeding a free ESP tier. The pitch is backup/re-access, not marketing. | M | Converts today's unrecoverable ~70 engagers into a list; enables day-3/day-7 sequences and the eventual back-end. |
| 6 | **Landing trust layer:** one chart-wheel image above the fold, honest proof line ("N charts cast") or 3 real buyer quotes from the 33, "No card. No email. Instant." under the CTA, privacy + terms links in a footer, contrast fix on tagline/icons. | S | Lifts landing→free-chart and free-chart→checkout; required hygiene for Meta ad review. |
| 7 | **Brand tells:** rename Stripe display name "Allmind" → "Coven Compass," fix the 🐴 tab-title emoji, add a favicon/sigil, add OG tags with a wheel image, unify placeholder styling. | S | Checkout-page merchant-name trust; link previews; removes "sketchy" micro-tells. |
| 8 | **CTA placement:** buy button directly under the wheel + a sticky bottom bar ("Get everything — $10") on mobile after cast. | S | Catches peak-desire moment; cheap conversion lift. |
| 9 | **Birth-time escape hatch:** "I don't know my exact time" → cast at 12:00 with an honest note on rising-sign uncertainty. | S | Removes the top form-abandonment objection without lying about precision. |
| 10 | **Buyer email sequence + AOV fix.** Send the 33 Stripe emails a 3-touch sequence (fulfillment → "how to read your chart" → "cast one for someone you love" gift angle). Then test a $7 post-purchase add-on (printed PDF edition) on the success page, and re-test $12 once checkout conversion recovers. Redefine the kill line on contribution profit, not AOV. | M | Creates the missing LTV layer; ends the under-water unit economics. |

---

## 3. Facebook ad style recommendation

**Context that drives every choice below:** buyers are mobile, tapping from Instagram/Facebook in-app, sound-off by default, skimming in 2–4 seconds, skeptical of anything asking for data, and the product's own visuals (gold-on-black wheel, card flips, streaming reading text) are better than anything you could stock-shoot.

**Format**
- **Primary: vertical 9:16 video, 15–20s, built from screen recordings of the actual product.** The wheel casting itself, a tarot card 3D flip, reading text streaming in. Screen-record at 390px, add burned-in captions, slow it 10–20% for a ceremonial feel. Zero budget, zero actors, and it doubles as the ad-landing echo (the ad shows exactly what the landing delivers — Pattern 1).
- **Add two static image ads** as a cheap hook-testing layer: one = the rendered natal wheel on black with the hook line in gold serif; one = a card spread + "23,166 words about you." Statics let you test 6 hooks in a day without editing, and aesthetic statics historically overperform in spirituality niches.
- **One 3-card carousel** as a value-stack reveal: Chart → Tarot → Spells, each card a real product screenshot with a one-line caption. Use it for retargeting once the pixel (Action #1) is live.

**Visual direction**
- Palette locked to the brand: near-black `#0d0a14`, antique gold `#C5A55A`, violet undertone; Cinzel-style serif for any text-in-creative. No stock witches, no candle-library B-roll, no hands-with-crystals stock footage — this brand's edge is that the product looks like a grimoire, not a dropship candle store.
- Motion: slow and candle-lit — gold particles, a wheel drawing itself stroke by stroke, a card turning. Nothing flashy; the mood is "secret, personal, premium."
- First frame is always the product artifact (wheel or card), never a logo.

**Hooks (first 2 seconds, burned-in text)**
1. "Your birth chart already wrote your next 12 months." — over the wheel casting itself.
2. "This tarot deck knows your Sun sign — and it lives on your phone." — over a card flip into a reading that names your sign.
3. "I cast my chart free and it wrote 23,000 words about me. I read every one." — over a fast screen-scroll of the actual reading.

**Primary text**

*Variant A — curiosity/privacy (lead):*
"Your chart is already written — cast it free, and it stays on your device. No account. No subscription. Nobody else sees it. Unlock a ~23,000-word reading of your exact placements, an AI tarot reader that weaves your Sun sign into every draw, and a spell planner timed to your chart. One-time $10. Yours forever."

*Variant B — rent-vs-own:*
"Astrology apps charge $9.99 *every month* to rent your own chart back to you. Coven Compass is $10 once: a full reading of every planet, house and aspect, infinite tarot readings that run privately on your phone, and a spell planner aligned to your element. No subscription. Ever."

**Headline:** "Your full birth chart, tarot & spells — $10 once"

**CTA button:** "Learn More" for cold prospecting — the ad sells the free-chart micro-commitment, and Learn More has the lowest friction for in-app placements. Test "Get Offer" as the variant. Avoid "Shop Now" (signals shipped-product ecommerce and mismatches a digital deliverable).

**Sequencing note:** launch new creative only after Actions #1–2 (pixel + verified checkout). Otherwise you'll optimize toward a checkout that still can't close, and you'll learn nothing from the data because there is none.

---

## Verification log (what was actually checked)

- Desktop golden path: form → place autocomplete → chart cast → wheel + personalized upsell ✅
- Buy click (normal UA) → embedded Stripe modal with live pk_live key ✅
- Instagram webview UA → hosted Stripe redirect to live `cs_live_…` session ✅; page header shows "Allmind" (flagged)
- `localStorage.clear()` → /hub redirects to landing (gate works) ✅
- Served-page grep: zero fbq/fbevents/facebook.net/tiktok/gtag on ANY page; only Cloudflare beacon loads (verified via performance resource entries too) — pixel finding confirmed
- No OG tags, no favicon, 🐴 in tab title, no privacy/terms links
- Page weights: landing 5.8KB compressed; places.js ~542KB compressed; tarot page 3.5MB (model lazy-loaded, not downloaded)
- Stripe checkout page: hosted flow collects email first ✅

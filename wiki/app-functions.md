# Coven Compass — App Function Manifest (verified 2026-09-23)

Canonical list of every function the app must show, with live-verification status.
Statuses: VERIFIED (exercised live) / PRESENT (layer loads, not fully exercised) / OPEN.

## 1. Landing / Sales page (`/` — index.html)
- VERIFIED Free birth chart cast: date, time, city autocomplete → chart computed client-side
- VERIFIED Mini chart: Sun / Moon / Rising + real counts (23,166 words, 27 aspects, 204 dated forecasts)
- VERIFIED Full natal wheel rendered by the paid product's own engine, aspects colored by type
- VERIFIED Deliverable flex cards (full chart interpretation / AI tarot / spell planner+tracker)
- VERIFIED Price anchor: $10 one time, no subscription
- VERIFIED Checkout: embedded modal (real browsers) / Stripe hosted redirect (in-app webviews)
- VERIFIED Birth-time escape hatch ("Don't know your birth time?" → noon cast)
- VERIFIED Returning visitor auto-cast + "Not you? Start over"
- VERIFIED Meta pixel PageView + InitiateCheckout
- VERIFIED "Already unlocked? Enter →" routes to gated /enter.html

## 2. Payment + access
- VERIFIED Stripe checkout session creation (embedded + hosted modes)
- VERIFIED /success: session verified against Stripe before unlock; Purchase pixel only on verified purchase
- VERIFIED /enter.html: email lookup against Stripe completed sessions → unlocks device
- VERIFIED gate.js on /hub, /chart, /spells, /tarot — unlocked devices only, else bounce to /
- VERIFIED Webhook (checkout.session.completed): idea_id guard, email link /enter.html?email=…
- PRESENT Webhook signature verification (pass-through until the endpoint secret is rotated)
- VERIFIED `/app` (legacy v1 link) → 302 /enter.html

## 3. Hub (`/hub`)
- VERIFIED Greeting with chart summary (Sun / Moon / Rising + birth place)
- VERIFIED Three cards: My Chart, Tarot Reader, Spell Designer
- VERIFIED Chartless-but-paid state: cast-first banner, no bounce (fix 2026-09-23)
- VERIFIED "Start over" (clears cached profile)

## 4. Chart (`/chart`)
- VERIFIED Full natal reading render (~133k chars DOM), 8 sections
- VERIFIED Natal wheel
- VERIFIED Stats block
- VERIFIED TOC — 7 links, click scrolls to section
- PRESENT Print / save as PDF (`#print`)
- VERIFIED No-chart fallback message + cast link

## 5. Tarot Reader (`/tarot`)
- VERIFIED 3-card spread, 78-card deck, draw interaction
- VERIFIED On-device AI (lazy boot on first draw; 530 MB model, OPFS-cached)
- VERIFIED Sun-sign context woven into the reading (CovenProfile.chartContext, degrades if absent)
- VERIFIED OOM hardening: mobile renderer diet, 12fps throttle during inference, idle dispose (90s)
- VERIFIED Stall watchdog → graceful classic reading fallback
- VERIFIED Token budget: max_tokens 1536 + explicit cpuContext 2560 (phone truncation fix)
- OPEN First-download UX on the live origin (swap reset the per-origin cache) — needs a real device pass

## 6. Spell Designer (`/spells` — original v1 product, ported whole 2026-09-23)
- VERIFIED Intention lookup — 30 intentions; sheet with herbs (10 each), crystals, candle, day, moon, element, incense, deities, tarot card, direction, oil, usage ritual
- VERIFIED Three dropdowns populated: intentionSelect 31, spellIntention 31, spellMoon 8
- VERIFIED Tabs: Lookup / Reverse / Spell Log / Supplies
- VERIFIED Reverse lookup — ingredient → all intentions using it (labradorite → intuition)
- VERIFIED Spell log: intention, date, moon phase, ingredient checkboxes, custom ingredients, notes, outcome
- VERIFIED Outcome analysis — success stats across logged spells
- VERIFIED Spell history list + per-entry delete
- VERIFIED Supplies tracker with checkable inventory
- PRESENT CSV export (`exportSpellsCSV`)
- PRESENT Print sheet (`printSheet`)
- PRESENT Offline save (`saveOffline`)
- VERIFIED Moon-phase calculator (live: waxing_gibbous)
- VERIFIED Storage: `coven_spells` (same key as v1 — buyer logs carry over) + legacy-shape migration

## 7. Compliance / infrastructure
- VERIFIED Privacy + Terms pages, footer links
- VERIFIED OG tags + share image, favicon
- VERIFIED "No card. No email. Instant." microcopy
- VERIFIED Route: coven-compass.allmind.biz → coven-compass-v2 worker (rollback documented in SWAP.md)
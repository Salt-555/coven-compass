# Wiki Log — Coven Compass

> Chronological record of all wiki actions. Append-only.
> Format: `## [YYYY-MM-DD] action | subject`
> Actions: seed, ingest, update, query, lint, create, archive, delete

## [2026-08-22] seed | Wiki initialized
- Domain: Coven Compass business intelligence
- Structure created: SCHEMA.md, index.md, log.md, entities/coven-compass.md
- Seeded from business-ideas.json (id: coven-compass)

## [2026-08-22] create | Kill post-mortem
- Wrote queries/kill-postmortem-2026-08-22.md (CPA $23 > $12, re-run TIER 1 line fired)
- Updated index.md (2 pages)

## [2026-09-22] update | Wiki brought current
- entities/coven-compass.md rewritten: active main target, $10 bundle, current metrics (33 customers / $330 / CPA ~$9.70), promotion_blocked, checkout-friction open problem
- created comparisons/pricing-history.md ($12 → $17 → $12 → $27 → $10 with conversion reads)
- created queries/bundle-merge-tarot-2026-09-10.md (tarot-reader merge per Salt 2026-09-10; webhook-router gap noted)
- patched queries/kill-postmortem-2026-08-22.md with SUPERSEDED banner (reversal 2026-08-17, merge 2026-09-10)
- Updated index.md (4 pages)

## [2026-09-22] create | v2 test deploy record
- Wrote queries/v2-test-deploy-2026-09-22.md (coven-v2.allmind.biz shadow build; chart-centered bundle; verified list + open items)
- Updated index.md (5 pages)

## 2026-09-23 — storefront funnel built on v2
Landing rebuilt as free mini-chart → $10 upsell (plan: 2026-09-23_093032). v2 gained its first worker script (checkout embedded+hosted_page, webhook with optional sig verify). Deployed + verified live on coven-v2. Swap pending Salt go; ZIP retirement open.

## 2026-09-23 — pre-flight hardening
Pixel+events ported to v2 (v1 had them; v2 rebuild had dropped). Trust layer, success-page inversion, rent-vs-own anchoring, privacy/terms, OG/favicon. Funnel review at funnel-review-2026-09-23.md. Dashboard toggles + phone purchase = remaining pre-swap items.

## 2026-09-23 — paywall closed
Email-verified unlock against Stripe records (no accounts, no DRM). gate.js on all app pages; success unlocks via session verification; Purchase pixel conditional on verified purchase. Verified live against a real buyer email.

## 2026-09-23 — SWAP LIVE
coven-compass.allmind.biz now serves v2 (storefront funnel, paywall, pixel). Zone-route flip, rollback documented in SWAP.md. v1 unrouted but intact.

## 2026-09-23 — original spell designer restored
Full v1 product ported wholesale to /spells (lookup, reverse, log+analysis, supplies, CSV, print, offline, rich DB). Storage-key compatible; legacy shapes migrate.

## 2026-09-23 — function manifest + hub fix
Wrote wiki/app-functions.md (all app functions, live-verified). Hub no longer bounces paid-but-chartless devices (cast-first banner instead). Tarot boots on the new origin.

## 2026-09-23 — chart page self-service
Chart page now takes birth details inline (chartless devices) and has a top "Change birth details" reset button, prefilled. Verified live: cast -> 133k-char reading, 7 TOC links, profile saved.

## 2026-09-23 — invisible reading fixed + no paywall kick-outs
The reading was rendering but hidden by vendor CSS (#out display:none). Fixed + verified by computed style. Chartless paid devices enter birth details inside the app (chart page form; hub CTA points there).

## 2026-09-24 — frontend review pass (5 reviewers)
18 findings fixed and verified live (blockers: dead affinity claim wired, gate kick-outs, ungated success receipt, cold-landing entry, typed-city dead end). Backlog: birthform extraction, desktop layout, tarot empty state, spells restyle, copy standardisation, a11y round 2. See wiki/frontend-review-2026-09-24.md

# Query: Storefront free-chart funnel (2026-09-23)

**Trigger:** Salt's idea — free trimmed star chart on the sales page, birthdate pre-cached, full chart + tarot + spells as the $10 upsell behind Stripe.

**Decision:** Built on the v2 test deploy (coven-v2.allmind.biz), swap via SWAP.md later.

## What shipped
- `public/index.html` rewritten as the storefront: birthdate form (same natalis places/zone wiring as chart entry) → silent full `renderReading` (its real stats power the teaser) → `buildMiniChart()` free teaser (Big Three + essence line + counts: words/aspects/transits — positions only, zero interpretation).
- `public/js/minichart.js` — pure, UMD, TDD (3 tests).
- `src/worker.js` — v2's first worker script: `/api/checkout` (embedded_page default; `?mode=hosted` → `ui_mode: hosted_page` for in-app webviews — fixes the 2026-09-18 funnel break where 17 sessions opened and 0 payment attempts happened), `/webhook` ported verbatim from v1 + optional Stripe signature verification. Secrets: STRIPE_SECRET_KEY, RESEND_KEY.
- `public/success.html` — post-payment entry to the kit.

## Key mechanics
- Returning visitors skip the form entirely: profile (`coven.profile`) is pre-cached; mini chart recomputes from saved birth. "Start over" clears it.
- Teaser counts are computed, not hardcoded — honest scarcity.
- `.html` assets 307 to clean paths under the worker + assets config.

## Lessons
- Stripe 2026 vocabulary: `ui_mode` is `embedded_page` / `hosted_page` (not `embedded`/`hosted`); embedded takes `return_url` ONLY, hosted takes `success_url` ONLY. Passing both → runtime exception (1101).
- `wrangler dev` (workerd) OOMs on the Pi 5 (tcmalloc 1GB mmap) — verify on the test-domain deploy instead.
- v1's webhook accepted unsigned payloads; v2 verifies when the secret is bound (pass-through otherwise, for the shared-endpoint window).

---
title: Coven Compass
created: 2026-08-22
updated: 2026-09-22
type: entity
tags: [industry, market, pricing, offer, build, growth]
sources: [business-ideas.json, deploy-metadata.json]
---

# Coven Compass

## Overview
The company's operating knowledge base: industry intel, competitors, pricing, creative learnings, and kill post-mortems.

## What it is now (2026-09-22)
**Active main target.** A one-time-purchase witchy kit: ingredient-lookup compass + spell tracker + AI tarot reader. Lives at https://coven-compass.allmind.biz as a single Cloudflare Worker (client-side, zero deps, honor-system access — no auth tokens, checkout + emailed ZIP is the gate). The 2026-08-22 kill was **reversed by Salt 2026-08-17**; the site was never taken down and it re-passed its TIER 1 re-run within 24h. See [[kill-postmortem-2026-08-22]] (superseded) and [[bundle-merge-tarot-2026-09-10]].

## Hypothesis
- **Pain point:** Practitioners cross-reference 5+ categories for any ritual — herbs, crystals, candle colors, day of week, moon phase, incense, elements. Data is scattered across blog posts and static PDFs. No interactive one-time-purchase tool combines it all, searchable by intention.
- **Who pays:** Witchy women 30-65, beginner to intermediate practitioners. r/witchcraft (450k+), r/Wicca (150k+), Etsy witchy digital products, Pinterest, TikTok witchy community. Already spending on crystals, candles, herbs, digital planners.
- **Offer:** Type an intention → all 7 correspondence categories. Plus a spell log (localStorage) and the bundled AI tarot reader. Free preview shows 3 of 7 lists; checkout unlocks the rest + `/app` hub.

## Competitive gap
Spells8 charges $29/mo, Moonly $30+ with hidden upsells, Etsy sells static non-searchable PDFs for $3-10. The wedge is **ownership without subscription** — proven by the buyer pool: 33 paid customers at $10.

## Pricing
Currently **$10 one-time** (Stripe price `price_1U9zgfIqUlirfBrC1m0LsG4q`, embedded checkout). Full trajectory with conversion reads: [[pricing-history]].

## Stage / status (as of 2026-09-22)
- stage: infant — execution: ACTIVE, scaling-blocked (AOV), promotion_blocked (7d CAC $13 > $5 cap)
- 33 customers / $330 epoch revenue / AOV $10
- Epoch CPA ~$9.70 vs $10 price — under the kill line but thin
- W39 margin −$36.96; best week W36 (+$46.88)
- **Open problem:** 70 initiate-checkouts vs 26 purchases in 30d — checkout-completion friction suspected; weekly audit recommends a checkout/price-anchor A/B
- Kill line: CPA > $10 (not tripped)

## Key facts
- Tarot reader merged in 2026-09-10 — ONE app, ONE $10 verdict ([[bundle-merge-tarot-2026-09-10]])
- Ad platform: Meta only, pixel 947012561524608, CPC $0.52-0.99 lane-proven
- Fulfillment: Stripe webhook → emailed ZIP; `/app` hub links `/app/compass` + tarot-reader.allmind.biz/read
- Known leak: `/app` routes are crawlable and ungated

## Related
- [[pricing-history]] — the $12 → $27 → $10 pricing record
- [[bundle-merge-tarot-2026-09-10]] — tarot-reader merge into the bundle
- [[kill-postmortem-2026-08-22]] — superseded kill, kept for the lessons
- [[index]] lists every page in this wiki.

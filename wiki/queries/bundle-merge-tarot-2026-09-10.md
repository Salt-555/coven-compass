---
title: Tarot Bundle Merge (2026-09-10)
created: 2026-09-22
updated: 2026-09-22
type: query
tags: [offer, build, launch, lesson]
sources: [business-ideas.json bundle_note, plans/2026-09-10 shared-stripe-webhook-router]
---

# Tarot Bundle Merge — 2026-09-10

Salt directive: **ONE APP, not a separate business.** tarot-reader ships as part of the coven-compass bundle.

## What changed
- Landing copy sells one kit: compass + AI tarot reader, $10 once.
- `/app` hub (added to the worker) links two tools: `/app/compass` and `tarot-reader.allmind.biz/read`.
- tarot-reader's traffic still counts toward the pooled ad baseline as evidence, but its revenue/spend are **NOT** an independent experiment's verdict — the $27 epoch was bundled into the same funnel that now sells at $10.
- tarot-reader's own webhook endpoint was deleted in the 09-10 cap cleanup. The bundle's fulfillment path is the coven-compass worker's webhook (idea_id guard) → emailed ZIP + hub link. Shared-stripe-webhook-router plan (2026-09-10) remains unimplemented — known gap.

## Why it worked
The 08-22 kill post-mortem predicted exactly this: "bundle spell-tracking INTO a tarot-style interactive tool (same buyer, adjacent pain)." The witchy audience was validated by tarot sales; the compass offer alone was weaker cold. Combined, the bundle re-passed TIER 1 within 24h of relaunch and is the current main target.

## Structural note
The bundle is a link-out hub, not a merged codebase — two workers, one Stripe product. Access is honor-system: no token check on either app. Fulfillment rests entirely on the coven-compass worker.

## Related
- [[coven-compass]] — the bundle's home
- [[kill-postmortem-2026-08-22]] — the post-mortem that prescribed this merge
- [[pricing-history]] — price eras the bundle spanned

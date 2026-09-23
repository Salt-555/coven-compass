---
title: Pricing History
created: 2026-09-22
updated: 2026-09-22
type: comparison
tags: [pricing, lesson, offer]
sources: [business-ideas.json, deploy-metadata.json]
---

# Pricing History — Coven Compass

| Era | Price | Read |
|-----|-------|------|
| 2026-07 launch | $12 | CPA ~$9.18 at best; margin $2.82. Converted but thin. |
| 2026-08-05 | $17 | Price test. Margin ~$8 if conversion held. Reverted to $12 per Salt 2026-08-11. |
| 2026-08-22 | $12 | Kill fired on re-run (CPA $23 > $12) — see [[kill-postmortem-2026-08-22]]. Reversed 08-17 directive kept site live. |
| 2026-08-29 | $27 → $10 | Brief $27 (slash anchor $25/mo → $10); new price `price_1U9zgfIqUlirfBrC1m0LsG4q`, e2e verified, old price deactivated. |
| 2026-09 → now | $10 | Epoch: 33 paid = $330, CPA ~$9.70. Under kill line but margin-collapsed vs the $0.52-0.99 CPC lane. |

## Learnings
- The witchy buyer pool converts at $10-12; the 08-22 kill was a bad-epoch artifact (cold re-run, no creative refresh), not a price rejection — the same audience had bought at $12 weeks earlier.
- $10 leaves ~$0.30 per ad-sourced customer at epoch CPA. **Every future pricing test must clear CAC + Stripe fees, not just the price.** Scaling gate is AOV, so the leverage is either higher AOV (bundle more in) or lower CPA — not another price cut.
- Anchor copy is $25/mo strikethrough → $10 once, "no subscription" as the repeated objection handler.
- Open question (weekly audit 2026-09-22): checkout/price-anchor A/B against the 70 initiate-checkouts → 26 purchases friction.

## Related
- [[coven-compass]] — current status
- [[kill-postmortem-2026-08-22]] — the kill the price survived

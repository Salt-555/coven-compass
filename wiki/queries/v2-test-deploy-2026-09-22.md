---
title: v2 Test Deploy (2026-09-22)
created: 2026-09-22
updated: 2026-09-22
type: query
tags: [build, launch, offer, lesson]
sources: [~/.hermes/plans/2026-09-22_084757-coven-compass-v2-chart-bundle.md]
---

# v2 Test Deploy — 2026-09-22

Shadow build of the next Coven Compass, deployed at **https://coven-v2.allmind.biz** (private repo github.com/Salt-555/coven-compass-v2, static-assets Worker via wrangler — no Stripe during test phase). Live product untouched; promotion path in the repo's `SWAP.md`.

## What v2 is
Chart-centered bundle: Natalis chart entry (full computeChart engine + full
renderReading output — cover, wheel, Big Three, signature, planets, aspects,
dated 12-month transits, appendix; ~23k words / 56 printed pages) → hub →
Tarot Reader + Spell Designer, all personalized off `localStorage['coven.profile']`.

Personalization contract: `public/js/profile.js` (CovenProfile) is the one
canonical source for the chart context string. Tarot injects it into the
reading's **user message** (never the prewarmed system prompt). Spells sorts
intentions by sun-element affinity (DB's per-intention `element`, case-folded),
shows a real power window (next Moon-in-sun-sign date + solar-return season via
the ephemeris), and the spell log (same `coven_spells` key as live) carries a
moon-in-your-sign column.

## Verified (headless + live)
- Golden chart: 1990-06-15 14:30 Denver → Sun Gemini / Moon Pisces / Libra rising — matches natalis engine
- Full reading renders live, identical word/page/aspect/transit counts to natalis
- Element affinity: air profile → 9 intentions aligned + sorted first (15/15 unit tests incl. real-DB fixture)
- Tarot: chart block present in userMsg with profile, absent without (fake-LLM capture)
- Model: canonical llm-local.js (md5 match), pin `prefer:'cpu'` + qwen3.5-0.8b in tarot/index.html local + live; boots from cache in ~75 s on the Pi; crossOriginIsolated true

## Open
- **Real-model streamed reading unverified headless** — inference stalled at 0 tokens in a background/headless tab (ask() returned null choices). Pending Salt's phone test. Everything up to the model call is verified; this is the last unknown.
- Landing-vs-chart-entry placement decision at swap (SWAP.md step 2).
- llm_app_check.py FAILs are scaffold-layout assumptions (single-app entry); pin verified directly instead.

## Lessons
- natalis's engine is load-bearing beyond its landing: corpus files (aspects, foundations, planet-sign/house, transits) must ALL ship for renderReading to exist. Miss one and the page silently renders nothing.
- Static-assets Worker (GitHub-style build) handles the ~15MB bundle the embedded-string worker pattern could not.

## Related
- [[coven-compass]] — current live state
- [[bundle-merge-tarot-2026-09-10]] — the bundle v2 supersedes
- [[pricing-history]] — pricing context for the swap decision

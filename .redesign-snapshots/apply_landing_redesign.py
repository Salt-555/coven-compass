#!/usr/bin/env python3
"""Apply a visual-only landing-page redesign to Coven Compass.
Preserves all IDs, scripts, checkout URLs, and existing product demo behavior.
"""
from pathlib import Path

p = Path('/home/salt/.hermes/mvps/coven-compass/src/landing.html')
s = p.read_text()
original = s

# The design is a Decide/Learn surface: product proof leads; editorial sales copy supports it.
overrides = r'''

    /* 2026 editorial product redesign — visual layer only */
    :root{--paper:#fcf7ee;--ink-bright:#fbf8ff;--line:rgba(227,199,143,.23);--panel:rgba(20,16,38,.76)}
    body{line-height:1.62}
    .container{max-width:1120px;padding:0 32px}
    .site-nav{position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;gap:24px;width:100%;max-width:none;margin:0;padding:15px max(32px,calc((100vw - 1120px)/2));background:linear-gradient(180deg,rgba(13,10,26,.92),rgba(13,10,26,.72));border-bottom:1px solid rgba(227,199,143,.13);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
    img[src^="data:image/jpeg"]{color:transparent;font-size:0;background:radial-gradient(circle at 36% 28%,rgba(227,199,143,.16),transparent 22%),linear-gradient(145deg,#211936,#0d0a1a);object-position:center}
    .brand-mark{display:flex;align-items:center;gap:10px;color:var(--ink-bright);font-family:'Cinzel',serif;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;white-space:nowrap}
    .brand-mark b{color:var(--gold);font-size:19px;font-weight:400;line-height:1}
    .site-links{display:flex;align-items:center;gap:25px}
    .site-links a{color:rgba(239,234,246,.72);font-size:11px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;transition:color .18s ease}
    .site-links a:hover{color:var(--gold)}
    .nav-cta{padding:10px 16px!important;border:1px solid rgba(227,199,143,.5);border-radius:999px;color:var(--ink-bright)!important;background:rgba(227,199,143,.10);box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}
    .hero-stage{display:grid;grid-template-columns:minmax(0,.94fr) minmax(390px,1.06fr);align-items:center;gap:58px;max-width:1120px;margin:0 auto;padding:82px 32px 94px;min-height:660px}
    .hero-stage .hero{order:1;text-align:left;padding:0}
    .hero-stage .demo-bar{order:2;padding:0}
    .hero-stage .demo-bar .container{padding:0;max-width:none}
    .hero-stage .demo-box{max-width:none;margin:0;position:relative;border-radius:18px;background:linear-gradient(145deg,rgba(42,31,72,.87),rgba(15,12,29,.92));box-shadow:0 38px 100px rgba(0,0,0,.5),0 0 0 1px rgba(227,199,143,.08),0 0 100px rgba(139,111,192,.13)}
    .hero-stage .demo-box:before{content:'LIVE LOOKUP PREVIEW';position:absolute;z-index:2;right:18px;top:-13px;padding:5px 10px;border:1px solid rgba(227,199,143,.45);border-radius:999px;background:#1c1636;color:var(--gold);font-family:'Cinzel',serif;font-size:8px;letter-spacing:.16em}
    .hero-stage .demo-inner{padding:28px}
    .hero-stage .demo-header{padding:12px 16px}
    .hero-stage .demo-cta-msg{max-width:420px;margin:18px auto 0;font-size:15px}
    .hero .moon-glyph{margin:0 0 12px;font-size:32px}
    .hero .hero-label{margin-bottom:20px;font-size:11px;letter-spacing:.32em}
    .hero h1{font-size:clamp(42px,5.2vw,70px);line-height:.99;letter-spacing:-.035em;max-width:640px;margin-bottom:24px;text-wrap:balance}
    .hero .subhead{font-size:24px;line-height:1.42;max-width:590px;margin:0 0 30px;color:#cbc3da;font-style:normal}
    .hero .subhead strong{color:var(--paper);font-weight:500}
    .cta-btn{border-radius:999px;padding:18px 28px;background:linear-gradient(135deg,#8b6fc0,#513271);box-shadow:0 12px 35px rgba(89,57,140,.38),inset 0 1px 0 rgba(255,255,255,.22)}
    .hero .cta-note{font-size:14px;margin-top:16px;color:#c9c1d7}
    .hero .trust-line{font-size:12px;line-height:1.55;max-width:510px;color:#aaa2bb}
    .proof-strip{display:flex;flex-wrap:wrap;gap:0;max-width:1120px;margin:0 auto;padding:0 32px 76px}
    .proof-strip div{flex:1 1 180px;padding:16px 22px;border-left:1px solid var(--line);color:#bfb6ce;font-size:13px;line-height:1.45}
    .proof-strip div:first-child{border-left:0;padding-left:0}
    .proof-strip b{display:block;margin-bottom:4px;color:var(--gold);font-family:'Cinzel',serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase}
    .pain,.solution,.compare,.proof,.faq,.cta{padding:108px 0}
    .pain{background:linear-gradient(180deg,rgba(13,10,26,.05),rgba(30,20,52,.30));border-top:1px solid rgba(227,199,143,.12)}
    .section-label{text-align:left;margin-bottom:19px;color:var(--gold);font-size:10px}
    .section-title{font-family:'Cinzel',serif;font-size:clamp(28px,3vw,43px);line-height:1.1;letter-spacing:-.025em;color:var(--ink-bright);max-width:760px;margin:0 0 42px}
    .pain-grid{grid-template-columns:repeat(3,1fr);gap:14px}
    .pain-card{min-height:235px;padding:28px;background:rgba(26,20,46,.65);border-color:rgba(227,199,143,.16);transition:transform .2s ease,border-color .2s ease}
    .pain-card:hover{transform:translateY(-4px);border-color:rgba(227,199,143,.44)}
    .pain-card .icon{filter:none;font-size:20px}
    .pain-card p{font-family:'Inter',sans-serif;font-size:15px;line-height:1.65;color:#d3ccdf}
    .solution{background:linear-gradient(135deg,rgba(68,42,103,.36),rgba(20,16,38,.16));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .solution .section-label{color:var(--gold)!important}
    .solution .container{padding-top:0!important;padding-bottom:0!important}
    .solution-visual{display:grid;grid-template-columns:1.18fr .82fr;gap:26px;align-items:end;max-width:none;margin:0 0 54px;text-align:left}
    .solution-altar{grid-row:1/3;min-height:430px;position:relative;overflow:hidden;border:1px solid rgba(227,199,143,.18);border-radius:14px;background:radial-gradient(circle at 24% 38%,rgba(227,199,143,.34),transparent 2%,transparent 18%),radial-gradient(circle at 60% 34%,rgba(139,111,192,.28),transparent 0 18%,rgba(13,10,26,.12) 19%),radial-gradient(ellipse at 50% 120%,rgba(108,62,66,.34),transparent 55%),linear-gradient(145deg,#2b1d3e,#0d0a1a 68%);box-shadow:0 35px 90px rgba(0,0,0,.45)}
    .solution-altar:before{content:'✦  •  ☾  •  ✦';position:absolute;top:34px;left:38px;color:rgba(227,199,143,.55);font-family:'Cinzel',serif;font-size:14px;letter-spacing:.35em}.solution-altar:after{content:'A quiet space for the materials, timing, and notes that belong to your practice.';position:absolute;left:38px;right:38px;bottom:34px;color:#eee6f4;font-family:'Cormorant Garamond',serif;font-size:29px;line-height:1.12;font-style:italic}
    .solution-visual:after{content:'A reference layer for your personal practice — made to be used, not merely admired.';display:block;padding:0 5px 4px;color:#e8e0ef;font-family:'Cormorant Garamond',serif;font-size:30px;line-height:1.12;font-style:italic}
    .solution-visual-cap{margin:0 5px;font-family:'Inter',sans-serif;font-size:12px;line-height:1.6;color:#b3a9c2;font-style:normal}
    .benefits{grid-template-columns:repeat(2,1fr);gap:14px}
    .benefit{min-height:188px;padding:27px 28px;background:rgba(11,9,22,.40);border-color:rgba(227,199,143,.16);border-radius:12px}
    .benefit:before{width:1px;background:linear-gradient(to bottom,var(--gold),transparent)}
    .benefit h3{font-size:15px;color:var(--ink-bright);letter-spacing:.02em}
    .benefit p{font-size:14px;color:#c0b7ce;line-height:1.6}
    .compare{background:rgba(13,10,26,.45)}
    .compare .section-label{text-align:center;margin-bottom:18px}
    .compare-grid{max-width:820px;gap:18px}
    .compare-card{padding:42px 34px;border-radius:15px}
    .compare-card .name{font-size:38px;letter-spacing:-.04em}
    .compare-card .desc{font-size:14px;line-height:1.62}
    .proof{padding:82px 0;background:rgba(20,16,38,.42)}
    .stats{justify-content:space-between;gap:20px}
    .stat{min-width:170px;padding:15px}
    .stat-num{font-size:46px;color:var(--gold)}
    .stat-label{font-size:10px;color:#b9afc9}
    .faq{padding:104px 0}
    .faq-list{max-width:850px;margin:0}
    .faq-item{padding:28px 0;display:grid;grid-template-columns:270px 1fr;gap:42px}
    .faq-item h3{font-size:14px;margin:0;line-height:1.5}
    .faq-item p{font-size:15px;line-height:1.68;color:#c7bed5}
    .cta{padding:124px 0;background:radial-gradient(ellipse 60% 100% at 50% 50%,rgba(101,67,145,.28),transparent 70%);text-align:left}
    .cta .container{max-width:840px}
    .cta .divider{margin:0 0 36px!important}
    .cta h2{font-size:clamp(34px,4vw,54px);line-height:1.05;letter-spacing:-.03em;text-wrap:balance}
    .cta p{max-width:570px;font-family:'Inter',sans-serif;font-size:16px;line-height:1.65;color:#c7bed5;font-style:normal}
    footer{text-align:left;padding:45px 0;background:rgba(8,6,16,.75)}
    footer p{font-size:11px;color:#9f96b2}
    @media(max-width:840px){
      .site-nav{padding:13px 20px}.site-links{display:none}.site-nav .nav-cta{display:block;font-size:9px}
      .hero-stage{display:flex;flex-direction:column;gap:34px;min-height:0;padding:46px 22px 60px}.hero-stage .hero{order:1;text-align:center}.hero-stage .demo-bar{order:2;width:100%}.hero .subhead{font-size:21px}.hero .trust-line{margin-left:auto;margin-right:auto}.container{padding:0 22px}.proof-strip{padding:0 22px 54px}.proof-strip div{min-width:45%;padding:14px;border-left:0;border-top:1px solid var(--line)}.proof-strip div:first-child{padding-left:14px}
      .pain,.solution,.compare,.proof,.faq,.cta{padding:68px 0}.pain-grid,.benefits{grid-template-columns:1fr}.pain-card,.benefit{min-height:0}.solution-visual{grid-template-columns:1fr;gap:16px}.solution-altar{grid-row:auto;min-height:330px}.solution-altar:after{font-size:26px}.solution-visual:after{font-size:27px}.compare-grid{grid-template-columns:1fr}.faq-item{grid-template-columns:1fr;gap:8px}.faq-list{margin:0}.cta{text-align:center}.cta .divider{margin-left:auto!important;margin-right:auto!important}footer{text-align:center}
    }
'''

needle = '  </style>'
assert s.count(needle) == 1, 'Expected exactly one stylesheet close'
s = s.replace(needle, overrides + needle)

# New conversion navigation and a desktop-only asymmetric hero wrapper.
needle = '  <div class="atmo-grain" aria-hidden="true"></div>\n'
nav = '''  <div class="atmo-grain" aria-hidden="true"></div>
  <nav class="site-nav" aria-label="Coven Compass navigation">
    <a class="brand-mark" href="#top"><b aria-hidden="true">☾</b> Coven Compass</a>
    <div class="site-links">
      <a href="#how-it-works">How it works</a>
      <a href="#inside">Inside</a>
      <a href="#pricing">One-time price</a>
      <a href="#questions">Questions</a>
      <a class="nav-cta" href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" onclick="if(typeof fbq==='function')fbq('track','InitiateCheckout',{value:12.00,currency:'USD'})">Get it — $12</a>
    </div>
  </nav>
  <main id="top" class="hero-stage">
'''
assert needle in s, 'Atmosphere anchor not found'
s = s.replace(needle, nav, 1)

needle = '  </section>\n\n  <!-- THE PAIN -->'
replacement = '''  </section>
  </main>
  <section class="proof-strip" aria-label="Coven Compass promises">
    <div><b>01 / Lookup</b>Choose an intention. See the practical correspondences in one calm view.</div>
    <div><b>02 / Record</b>Keep notes on your own rituals and notice personal patterns over time.</div>
    <div><b>03 / Keep</b>$12 once. No account, no monthly fee, no rented access.</div>
  </section>

  <!-- THE PAIN -->'''
assert needle in s, 'Hero closing anchor not found'
s = s.replace(needle, replacement, 1)

# IDs let the new navigation be meaningful, without touching scripts or interactive DOM.
s = s.replace('<section class="pain">', '<section class="pain" id="how-it-works">', 1)
s = s.replace('<div class="solution">', '<div class="solution" id="inside">', 1)
s = s.replace('<div class="solution-visual"><img ', '<div class="solution-visual"><div class="solution-altar" role="img" aria-label="A quiet atmospheric altar space for your ritual materials"></div><img hidden ', 1)
s = s.replace('<section class="compare">', '<section class="compare" id="pricing">', 1)
s = s.replace('<section class="faq">', '<section class="faq" id="questions">', 1)

# Improve semantic precision in the single top-level promise; all checkout wiring remains identical.
s = s.replace(
    'Herbs, crystals, candle colors, days, moon phases — every ingredient your spell calls for, for any intention. Plus a spell tracker that shows you what actually works. All for $12. One time.',
    'A living ritual reference for <strong>herbs, crystals, candle colors, days, moon phases, elements, and incense</strong> — plus a private spell log for noticing your own patterns over time. $12 once. Yours permanently.',
    1,
)
s = s.replace('<p class="section-label">Sound Familiar?</p>', '<p class="section-label">The familiar friction</p>\n      <h2 class="section-title">A personal practice deserves better than open tabs, scattered notes, and another monthly bill.</h2>', 1)
s = s.replace('<p class="section-label" style="color:rgba(255,255,255,.5)">What You Get</p>', '<p class="section-label" style="color:rgba(255,255,255,.5)">The reference, made usable</p>\n      <h2 class="section-title">The ingredients are only the beginning. The point is a practice you can return to.</h2>', 1)
s = s.replace('<p class="section-label">The Math</p>', '<p class="section-label">One clear price</p>\n      <h2 class="section-title" style="text-align:center;margin-left:auto;margin-right:auto">Buy a tool once. Keep using it.</h2>', 1)
s = s.replace('<p class="section-label">Questions</p>', '<p class="section-label">Before you decide</p>\n      <h2 class="section-title">A few straight answers.</h2>', 1)

assert 'https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007' in s
assert "fbq('init','947012561524608')" in s
assert 'id="demoSelect"' in s and 'id="demoResults"' in s
assert s.count('<main ') == 1 and s.count('</main>') == 1
assert s != original
p.write_text(s)
print(f'Wrote redesigned landing: {p} ({len(s)} bytes)')

/**
 * ALLMIND MVP — Storefront Worker (Simplified)
 * =============================================
 * Payment Link → Success → Download. No custom checkout.
 * Proxy handles Stripe. This worker handles delivery.
 *
 * SETUP:
 *   1. Create a Stripe Payment Link (see deploy steps in SKILL.md)
 *   2. Set after_completion redirect to: {BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}
 *   3. Register webhook pointing to: {BASE_URL}/webhook
 *
 * BINDINGS (set by deploy script):
 *   PAYMENTS           — Service Binding → allmind-payments
 *   PAYMENT_HMAC_SECRET — Secret for proxy auth
 *   BASE_URL           — Plain text, this worker's URL
 *   RESEND_KEY         — Secret, for transactional emails
 *
 * ROUTES:
 *   GET  /         — Landing page (links to Payment Link)
 *   GET  /success  — Post-payment page (auto-downloads product)
 *   POST /webhook  — Stripe webhook (sends download email)
 *   GET  /download — Serves the purchased zip
 *   GET  /privacy  — Privacy policy
 *   GET  /terms    — Terms of service
 */

// ─── Payment Proxy Client ───
async function signPayload(body, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function callProxy(env, route, payload) {
  const body = JSON.stringify(payload);
  const signature = await signPayload(body, env.PAYMENT_HMAC_SECRET);
  const resp = await env.PAYMENTS.fetch(new Request(`https://proxy${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Signature': signature },
    body,
  }));
  const data = await resp.json();
  if (!resp.ok || !data.success) throw new Error(data.error || `Proxy error ${resp.status}`);
  return data.data;
}

// ─── Security Headers ───
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function addSecurityHeaders(response) {
  for (const [k, v] of Object.entries(securityHeaders)) response.headers.set(k, v);
  return response;
}

// ─── Helpers ───
function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

// ─── Route: GET /success ───
async function handleSuccess(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  let email = '';

  if (sessionId) {
    try {
      const sessionData = await callProxy(env, '/session', { session_id: sessionId });
      email = sessionData.email || '';
    } catch (e) {
      console.error(`[success] Session lookup failed: ${e.message}`);
    }
  }

  const downloadUrl = email ? `/download?email=${encodeURIComponent(email)}` : '#';
  const html = SUCCESS_PAGE_HTML
    .replace(/\{\{DOWNLOAD_URL\}\}/g, downloadUrl)
    .replace(/\{\{CUSTOMER_EMAIL\}\}/g, email);

  return htmlResponse(html);
}

// ─── Route: POST /webhook ───
async function handleWebhook(request, env) {
  let event;
  try { event = JSON.parse(await request.text()); }
  catch (e) { return jsonResponse({ error: 'Invalid payload' }, 400); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    let email = session.metadata?.email || session.customer_email || null;

    // Look up email from customer if not on session
    if (!email && session.customer) {
      try {
        const customerData = await callProxy(env, '/session', { session_id: session.id });
        email = customerData.email || null;
      } catch (e) {
        console.error(`[webhook] Email lookup failed: ${e.message}`);
      }
    }

    if (email) {
      await sendDownloadEmail(env, email);
    } else {
      console.error('[webhook] Could not determine customer email');
    }
  }

  return jsonResponse({ received: true });
}

// ─── Route: GET /download ───
async function handleDownload(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return htmlResponse('<h1>Email required</h1>', 400);

  if (typeof ZIP_DATA === 'undefined') return htmlResponse('<h1>Package not ready</h1>', 500);

  const zipBytes = Uint8Array.from(atob(ZIP_DATA), c => c.charCodeAt(0));
  return new Response(zipBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="product.zip"',
      'Content-Length': zipBytes.length.toString(),
    },
  });
}

// ─── Email via Resend ───
async function sendDownloadEmail(env, email) {
  if (!env.RESEND_KEY) { console.log('[email] RESEND_KEY not set, skipping'); return; }

  const appUrl = `${env.BASE_URL}/app?access=unlocked`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '{{PRODUCT_NAME}} <noreply@allmind.biz>',
      to: [email],
      subject: 'Your download is ready',
      html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px">
        <h1 style="font-family:'Cormorant Garamond',serif;font-size:28px;margin-bottom:16px">You're in.</h1>
        <p style="color:#6B6560;font-size:15px;line-height:1.7;margin-bottom:24px">Thanks for your purchase. Your download is ready.</p>
        <a href="${appUrl}" style="display:inline-block;padding:14px 32px;background:#0A0A0A;color:#FAF7F2;text-decoration:none;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Open App</a>
        <p style="color:#9B9590;font-size:13px;margin-top:24px">Bookmark this link: ${appUrl}</p>
        <hr style="border:none;border-top:1px solid #F0EBE3;margin:32px 0">
        <p style="color:#9B9590;font-size:12px">Works on any device with a browser.<br>Questions? support@allmind.biz</p>
      </div>`,
    }),
  });

  if (!resp.ok) console.error(`[email] Failed: ${await resp.text()}`);
  else console.log(`[email] Download email sent to ${email}`);
}

// ─── Success Page HTML ───
const ZIP_DATA = "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";

const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coven Compass — Every Correspondence + Spell Tracker</title>
  <meta name="description" content="Herbs, crystals, candles, days, moon phases — lookup every spell correspondence for any intention instantly. Track your spells. $7 one-time. No subscription.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    :root{
      --void:#0A0A0F;--deep:#12111A;--card:#1A1825;--card-border:#2A2640;
      --purple:#8B6FC0;--purple-dim:#6B4FA0;--purple-glow:rgba(139,111,192,.15);
      --silver:#C8C3D4;--silver-dim:#8A8498;
      --amber:#D4A857;--amber-dim:#A8843A;
      --white:#EEEAF2;--muted:#6B6580;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,sans-serif;color:var(--silver);background:var(--void);line-height:1.7;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}

    .container{max-width:720px;margin:0 auto;padding:0 24px}

    /* HERO */
    .hero{text-align:center;padding:80px 0 0;position:relative}
    .hero-img-wrap{max-width:900px;margin:0 auto 48px;border-radius:12px;overflow:hidden;position:relative}
    .hero-img-wrap img{width:100%;height:auto;display:block}
    .hero-img-wrap::after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,rgba(10,10,15,.1) 0%,rgba(10,10,15,.6) 100%)}
    .hero-content{position:relative;z-index:1;margin-top:-120px;padding-bottom:60px}
    .hero-label{font-family:'Cinzel',serif;font-size:12px;font-weight:600;letter-spacing:.25em;text-transform:uppercase;color:var(--purple);margin-bottom:24px}
    .hero h1{font-family:'Cinzel',serif;font-size:clamp(30px,5.5vw,52px);font-weight:700;line-height:1.15;color:var(--white);letter-spacing:.02em;margin-bottom:20px;text-shadow:0 0 60px rgba(139,111,192,.2)}
    .hero .subhead{font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--silver-dim);max-width:500px;margin:0 auto 40px;font-style:italic;line-height:1.6}
    .cta-btn{display:inline-block;padding:16px 40px;font-family:'Cinzel',serif;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;background:linear-gradient(135deg,var(--purple) 0%,var(--purple-dim) 100%);color:var(--white);border-radius:6px;transition:transform .15s,box-shadow .2s;box-shadow:0 4px 20px rgba(139,111,192,.3)}
    .cta-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(139,111,192,.4)}
    .cta-note{font-size:12px;color:var(--muted);margin-top:14px;letter-spacing:.04em}

    /* DIVIDER */
    .divider{width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--purple),transparent);margin:0 auto}

    /* PAIN SECTION */
    .pain{padding:80px 0}
    .section-label{font-family:'Cinzel',serif;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);text-align:center;margin-bottom:36px}
    .pain-grid{display:grid;gap:12px}
    .pain-card{background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:24px 28px}
    .pain-card .icon{font-size:20px;margin-bottom:10px;opacity:.7}
    .pain-card p{font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--silver);line-height:1.6}

    /* SOLUTION */
    .solution{padding:80px 0;background:var(--deep);border-top:1px solid var(--card-border);border-bottom:1px solid var(--card-border)}
    .solution .intro{text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--silver-dim);max-width:520px;margin:0 auto 48px;line-height:1.7}
    .benefits{display:grid;gap:32px}
    .benefit{background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:28px;position:relative;overflow:hidden}
    .benefit::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%;background:linear-gradient(to bottom,var(--purple),transparent)}
    .benefit h3{font-family:'Cinzel',serif;font-size:16px;font-weight:600;color:var(--white);margin-bottom:8px;letter-spacing:.04em}
    .benefit p{font-size:14px;color:var(--silver-dim);line-height:1.6}

    /* PROOF */
    .proof{padding:64px 0}
    .stats{display:flex;justify-content:center;gap:48px;flex-wrap:wrap}
    .stat{text-align:center}
    .stat-num{font-family:'Cinzel',serif;font-size:36px;font-weight:700;color:var(--purple);line-height:1;margin-bottom:8px;text-shadow:0 0 30px rgba(139,111,192,.2)}
    .stat-label{font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:var(--muted)}

    /* COMPARISON */
    .compare{padding:60px 0;border-top:1px solid var(--card-border)}
    .compare .section-label{color:var(--amber)}
    .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:560px;margin:0 auto}
    .compare-card{padding:24px;border-radius:10px;text-align:center}
    .compare-bad{background:rgba(180,60,60,.08);border:1px solid rgba(180,60,60,.2)}
    .compare-good{background:var(--purple-glow);border:1px solid rgba(139,111,192,.25)}
    .compare-card .label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}
    .compare-bad .label{color:#D46060}
    .compare-good .label{color:var(--purple)}
    .compare-card .name{font-family:'Cinzel',serif;font-size:20px;font-weight:700;color:var(--white);margin-bottom:4px}
    .compare-card .price{font-size:13px;color:var(--silver-dim)}

    /* FAQ */
    .faq{padding:80px 0}
    .faq-list{max-width:580px;margin:0 auto}
    .faq-item{padding:24px 0;border-bottom:1px solid var(--card-border)}
    .faq-item:first-child{border-top:1px solid var(--card-border)}
    .faq-item h3{font-family:'Cinzel',serif;font-size:15px;font-weight:600;color:var(--white);margin-bottom:8px;letter-spacing:.03em}
    .faq-item p{font-size:14px;color:var(--silver-dim);line-height:1.6}

    /* CTA */
    .cta{padding:80px 0;text-align:center}
    .cta h2{font-family:'Cinzel',serif;font-size:clamp(24px,4vw,36px);font-weight:700;color:var(--white);margin-bottom:16px;letter-spacing:.02em}
    .cta p{font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--silver-dim);margin-bottom:36px;font-style:italic}

    /* FOOTER */
    footer{padding:40px 0;text-align:center;border-top:1px solid var(--card-border)}
    footer p{font-size:11px;color:var(--muted);line-height:2;letter-spacing:.04em}
    footer a{color:var(--purple-dim)}
    footer a:hover{color:var(--purple)}

    @media(max-width:640px){
      .hero-content{margin-top:-80px}
      .hero h1{font-size:28px}
      .stats{gap:28px}
      .compare-grid{grid-template-columns:1fr}
      .cta-btn{width:100%;text-align:center}
    }
  </style>
</head>
<body>

  <!-- HERO -->
  <section class="hero">
    <div class="hero-img-wrap">
      <img src="data:image/jpeg;base64,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" alt="Crystals, herbs, candles and tarot cards arranged on a dark wooden table by candlelight">
    </div>
    <div class="hero-content container">
      <p class="hero-label">Coven Compass</p>
      <h1>Look Up Any Correspondence.<br>Track Every Spell.</h1>
      <p class="subhead">Look up any correspondence. Log every spell you cast. See what actually works.</p>
      <a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="cta-btn">Get Coven Compass — $7</a>
      <p class="cta-note">One-time purchase. No subscription. Yours forever.</p>
    </div>
  </section>

  <!-- PAIN -->
  <section class="pain">
    <div class="container">
      <p class="section-label">The Frustration</p>
      <div class="pain-grid">
        <div class="pain-card">
          <div class="icon">🕯️</div>
          <p>You spend 30 minutes hunting through blogs, PDFs, and Pinterest boards just to find which herb goes with protection spells.</p>
        </div>
        <div class="pain-card">
          <div class="icon">💸</div>
          <p>Subscription apps charge you monthly for reference data that hasn't changed in centuries. Moonly wants $30. Spells8 wants $29/mo. For correspondences.</p>
        </div>
        <div class="pain-card">
          <div class="icon">📑</div>
          <p>You have five browser tabs open cross-referencing herbs, crystals, candle colors, days of the week, and moon phases — and you're still not sure you got it right.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- SOLUTION -->
  <div class="solution">
    <section class="container" style="padding:80px 0">
      <p class="section-label">The Answer</p>
      <p class="intro">Type your intention. Get every correspondence you need. Then log your spells and see what actually works. Herbs, crystals, candles, days, moon phases, elements, incense — plus spell tracking, all in one place.</p>
      <div class="benefits">
        <div class="benefit">
          <h3>⚡ Instant Lookup</h3>
          <p>Type an intention and get rosemary, black tourmaline, white candles, Saturday, waning moon, and dragon's blood incense in under two seconds. No tabs. No PDFs.</p>
        </div>
        <div class="benefit">
          <h3>🌙 Complete Results</h3>
          <p>Seven categories per intention. Herbs, crystals, candle colors, days, moon phases, elements, and incense. Everything for a full ritual, not just one piece.</p>
        </div>
        <div class="benefit">
          <h3>📱 Works Everywhere</h3>
          <p>Open it on your phone, tablet, or laptop. No app store, no install, no account. Bookmark it and use it whenever the mood strikes.</p>
        </div>
        <div class="benefit">
          <h3>📓 Track Your Practice</h3>
          <p>Log every spell with date, moon phase, ingredients, and outcome. Over time, see patterns — which moon phases, which herbs, which intentions actually work for you.</p>
        </div>
      </div>
    </section>
  </div>

  <!-- DEMO PREVIEW -->
  <section style="padding: 80px 0; background: var(--void);">
    <div class="container">
      <p class="section-label">See It In Action</p>
      <div style="background: var(--card); border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden; max-width: 560px; margin: 0 auto;">
        <!-- Mockup header -->
        <div style="background: var(--deep); padding: 12px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--card-border);">
          <div style="width: 10px; height: 10px; border-radius: 50%; background: #D46060;"></div>
          <div style="width: 10px; height: 10px; border-radius: 50%; background: var(--amber);"></div>
          <div style="width: 10px; height: 10px; border-radius: 50%; background: #5A9A5A;"></div>
          <span style="margin-left: auto; font-size: 11px; color: var(--muted); font-family: 'Inter', monospace;">coven-compass</span>
        </div>
        <!-- Search input mockup -->
        <div style="padding: 20px 20px 12px;">
          <div style="display: flex; align-items: center; gap: 10px; background: var(--deep); border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 16px;">
            <span style="color: var(--purple); font-size: 16px;">&#9906;</span>
            <span style="font-family: 'Cormorant Garamond', serif; font-size: 18px; color: var(--white); letter-spacing: 0.02em;">protection</span>
            <span style="margin-left: auto; font-size: 10px; color: var(--muted); background: var(--card-border); padding: 2px 8px; border-radius: 4px;">Enter</span>
          </div>
        </div>
        <!-- Results mockup -->
        <div style="padding: 0 20px 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div style="background: var(--deep); border-radius: 8px; padding: 14px 16px;">
            <p style="font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">Herbs</p>
            <p style="font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--white);">Rosemary, Sage, Basil</p>
          </div>
          <div style="background: var(--deep); border-radius: 8px; padding: 14px 16px;">
            <p style="font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">Crystals</p>
            <p style="font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--white);">Black Tourmaline, Obsidian</p>
          </div>
          <div style="background: var(--deep); border-radius: 8px; padding: 14px 16px;">
            <p style="font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">Candles</p>
            <p style="font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--white);">Black, White, Blue</p>
          </div>
          <div style="background: var(--deep); border-radius: 8px; padding: 14px 16px;">
            <p style="font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">Day</p>
            <p style="font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--white);">Saturday</p>
          </div>
          <div style="background: var(--deep); border-radius: 8px; padding: 14px 16px;">
            <p style="font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">Moon Phase</p>
            <p style="font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--white);">Waning</p>
          </div>
          <div style="background: var(--deep); border-radius: 8px; padding: 14px 16px;">
            <p style="font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px;">Incense</p>
            <p style="font-family: 'Cormorant Garamond', serif; font-size: 15px; color: var(--white);">Dragon's Blood</p>
          </div>
        </div>
      </div>
      <p style="text-align: center; color: var(--muted); font-size: 13px; margin-top: 20px; font-style: italic;">Every correspondence for "protection" — all seven categories, one screen, instant.</p>

      <!-- Spell Tracker Demo -->
      <div style="max-width: 560px; margin: 40px auto 0;">
        <p class="section-label">Spell Tracker</p>
        <div style="background: var(--card); border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden;">
          <div style="background: var(--deep); padding: 12px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--card-border);">
            <span style="margin-left: auto; font-size: 11px; color: var(--muted); font-family: 'Inter', monospace;">spell-log</span>
          </div>
          <div style="padding: 16px 20px; border-bottom: 1px solid var(--card-border);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <p style="font-family: 'Cormorant Garamond', serif; font-size: 17px; color: var(--white);">Protection Ritual</p>
              <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(90, 154, 90, 0.15); color: #5A9A5A; padding: 3px 10px; border-radius: 20px;">✓ Worked</span>
            </div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--silver-dim); margin-bottom: 10px;">
              <span>🌙 Waning Moon</span>
              <span>📅 Mar 15, 2026</span>
              <span>🕯️ Saturday</span>
            </div>
            <div style="background: var(--deep); border-radius: 6px; padding: 10px 14px; font-size: 13px; color: var(--silver-dim); line-height: 1.5;">
              <span style="color: var(--purple);">Ingredients:</span> Rosemary, black tourmaline, white candle, dragon's blood incense
            </div>
          </div>
          <div style="padding: 16px 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <p style="font-family: 'Cormorant Garamond', serif; font-size: 17px; color: var(--white);">Love Attraction</p>
              <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(212, 168, 87, 0.15); color: var(--amber); padding: 3px 10px; border-radius: 20px;">◐ Pending</span>
            </div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--silver-dim);">
              <span>🌕 Full Moon</span>
              <span>📅 Apr 2, 2026</span>
              <span>🕯️ Friday</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- FOR NEW WITCHES -->
  <section style="padding: 80px 0; background: var(--deep); border-top: 1px solid var(--card-border); border-bottom: 1px solid var(--card-border);">
    <div class="container" style="text-align: center;">
      <p class="section-label">New to the Craft?</p>
      <h2 style="font-family: 'Cinzel', serif; font-size: clamp(22px, 4vw, 32px); font-weight: 700; color: var(--white); margin-bottom: 16px; letter-spacing: .02em;">Skip the years of trial and error.</h2>
      <p style="font-family: 'Cormorant Garamond', serif; font-size: 18px; color: var(--silver-dim); max-width: 520px; margin: 0 auto 40px; line-height: 1.7; font-style: italic;">Every experienced witch spent months cross-referencing correspondences from dozens of sources. You don't have to.</p>
      <div style="display: grid; gap: 16px; max-width: 480px; margin: 0 auto; text-align: left;">
        <div style="background: var(--card); border: 1px solid var(--card-border); border-radius: 10px; padding: 20px 24px; display: flex; gap: 16px; align-items: flex-start;">
          <span style="font-size: 22px; flex-shrink: 0;">🌑</span>
          <div>
            <p style="font-family: 'Cinzel', serif; font-size: 14px; font-weight: 600; color: var(--white); margin-bottom: 4px;">Pick any intention</p>
            <p style="font-size: 14px; color: var(--silver-dim); line-height: 1.5;">Protection, love, prosperity, healing — 30 intentions to choose from. Type what you want and get started.</p>
          </div>
        </div>
        <div style="background: var(--card); border: 1px solid var(--card-border); border-radius: 10px; padding: 20px 24px; display: flex; gap: 16px; align-items: flex-start;">
          <span style="font-size: 22px; flex-shrink: 0;">🌿</span>
          <div>
            <p style="font-family: 'Cinzel', serif; font-size: 14px; font-weight: 600; color: var(--white); margin-bottom: 4px;">Get everything you need</p>
            <p style="font-size: 14px; color: var(--silver-dim); line-height: 1.5;">Herbs, crystals, candle colors, days, moon phases, elements, incense — all seven categories, laid out for you.</p>
          </div>
        </div>
        <div style="background: var(--card); border: 1px solid var(--card-border); border-radius: 10px; padding: 20px 24px; display: flex; gap: 16px; align-items: flex-start;">
          <span style="font-size: 22px; flex-shrink: 0;">✨</span>
          <div>
            <p style="font-family: 'Cinzel', serif; font-size: 14px; font-weight: 600; color: var(--white); margin-bottom: 4px;">Cast with confidence</p>
            <p style="font-size: 14px; color: var(--silver-dim); line-height: 1.5;">No guessing if you picked the right crystal or forgot an ingredient. Everything matches. Your first spell works like your hundredth.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- PROOF -->
  <section class="proof">
    <div class="container">
      <div class="stats">
        <div class="stat"><div class="stat-num">200+</div><div class="stat-label">Herbs &amp; Crystals</div></div>
        <div class="stat"><div class="stat-num">30</div><div class="stat-label">Intentions</div></div>
        <div class="stat"><div class="stat-num">7</div><div class="stat-label">Categories Each</div></div>
        <div class="stat"><div class="stat-num">∞</div><div class="stat-label">Spells Logged</div></div>
      </div>
    </div>
  </section>

  <!-- COMPARISON -->
  <section class="compare">
    <div class="container">
      <p class="section-label">The Math</p>
      <div class="compare-grid">
        <div class="compare-card compare-bad">
          <div class="label">Subscription Apps</div>
          <div class="name">$29-30<span style="font-size:14px;color:var(--silver-dim)">/mo</span></div>
          <div class="price">For data that hasn't changed in centuries.</div>
        </div>
        <div class="compare-card compare-good">
          <div class="label">Coven Compass</div>
          <div class="name">$7<span style="font-size:14px;color:var(--silver-dim)"> once</span></div>
          <div class="price">All the same data + spell tracking. Yours forever.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="faq">
    <div class="container">
      <p class="section-label">Questions</p>
      <div class="faq-list">
        <div class="faq-item">
          <h3>Does it work offline?</h3>
          <p>Yes. All the data is embedded. Once you have it, it works without internet on any device with a browser.</p>
        </div>
        <div class="faq-item">
          <h3>Is this for beginners or experienced practitioners?</h3>
          <p>Especially beginners. If you're just starting out, Coven Compass is like having an experienced witch's grimoire in your pocket. You don't need to spend months collecting correspondences from 50 different sources — pick an intention and everything you need is right there. Your first ritual will be as well-prepared as someone who's been practicing for years.</p>
        </div>
        <div class="faq-item">
          <h3>How is this different from free websites?</h3>
          <p>Free sites give you one category at a time across dozens of pages. Coven Compass gives you everything for your intention in one view.</p>
        </div>
        <div class="faq-item">
          <h3>Can I track my spells?</h3>
          <p>Yes! Log every spell with intention, ingredients, moon phase, and outcome. Over time, Coven Compass shows you patterns in your practice — which combinations work best, which moon phases yield results, and which intentions need adjustment. It's like having a personal grimoire that learns.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="cta">
    <div class="container">
      <div class="divider" style="margin-bottom:48px"></div>
      <h2>Your next ritual, fully planned<br>in seconds. Every one, tracked.</h2>
      <p>No subscription. No account. Just the answers you need — and a record of what works, forever.</p>
      <a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="cta-btn">Get Coven Compass — $7</a>
    </div>
  </section>

  <footer>
    <div class="container">
      <p>&copy; 2026 Coven Compass. An ALLMIND venture.<br>
      <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="mailto:support@allmind.biz">support@allmind.biz</a></p>
    </div>
  </footer>


  <!-- Meta Pixel Code -->
  <script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '947012561524608');
  fbq('track', 'PageView');
  </script>
  <noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=947012561524608&ev=PageView&noscript=1"/></noscript>
  <!-- End Meta Pixel Code -->
  <script src="https://allmind.biz/src/tracker.js" data-source="coven-compass"></script>
</body>
</html>
`;

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — Coven Compass</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Inter:wght@300;400;500&display=swap');
    :root { --cream: #FAF7F2; --cream-dark: #F0EBE3; --gold: #C5A55A; --black: #0A0A0A; --charcoal: #2D2D2D; --stone: #6B6560; --stone-light: #9B9590; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; font-weight: 300; line-height: 1.8; color: var(--charcoal); background: var(--cream); -webkit-font-smoothing: antialiased; }
    .container { max-width: 640px; margin: 0 auto; padding: 80px 24px; }
    h1 { font-family: 'Cormorant Garamond', serif; font-size: 36px; font-weight: 600; color: var(--black); margin-bottom: 8px; }
    .updated { font-size: 12px; color: var(--stone-light); letter-spacing: 0.05em; margin-bottom: 48px; }
    h2 { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 600; color: var(--black); margin: 40px 0 12px; }
    p { font-size: 14px; color: var(--stone); margin-bottom: 16px; }
    ul { margin: 0 0 16px 20px; }
    li { font-size: 14px; color: var(--stone); margin-bottom: 8px; }
    strong { font-weight: 500; color: var(--charcoal); }
    a { color: var(--gold); text-decoration: none; }
    a:hover { text-decoration: underline; }
    footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--cream-dark); font-size: 12px; color: var(--stone-light); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: April 17, 2026</p>

    <h2>AI-Operated Service</h2>
    <p>This service is operated by autonomous AI agents managed by <strong>ALLMIND</strong>.
    ALLMIND uses automated systems to deliver, maintain, and improve services across its product ecosystem.</p>

    <h2>Information We Collect</h2>
    <ul>
      <li><strong>Payment Information:</strong> Email address and payment details (processed securely by Stripe — we never see your full card number)</li>
    </ul>

    <h2>How We Use Information</h2>
    <p>We use your email solely to deliver your download link after purchase.</p>

    <h2>Data Sharing</h2>
    <p>We do not sell your data. We share information only with:</p>
    <ul>
      <li><strong>Stripe</strong> — for payment processing</li>
      <li><strong>Cloudflare</strong> — for hosting and security</li>
    </ul>

    <h2>Your Rights</h2>
    <p>You may request access, deletion, or correction of your data at any time.
    Email <a href="mailto:support@allmind.biz">support@allmind.biz</a>.</p>

    <h2>Contact</h2>
    <p>For privacy concerns: <a href="mailto:support@allmind.biz">support@allmind.biz</a></p>

    <footer>
      <a href="/">Back to Coven Compass</a>
    </footer>
  </div>
</body>
</html>
`;

const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — Coven Compass</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Inter:wght@300;400;500&display=swap');
    :root { --cream: #FAF7F2; --cream-dark: #F0EBE3; --gold: #C5A55A; --black: #0A0A0A; --charcoal: #2D2D2D; --stone: #6B6560; --stone-light: #9B9590; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; font-weight: 300; line-height: 1.8; color: var(--charcoal); background: var(--cream); -webkit-font-smoothing: antialiased; }
    .container { max-width: 640px; margin: 0 auto; padding: 80px 24px; }
    h1 { font-family: 'Cormorant Garamond', serif; font-size: 36px; font-weight: 600; color: var(--black); margin-bottom: 8px; }
    .updated { font-size: 12px; color: var(--stone-light); letter-spacing: 0.05em; margin-bottom: 48px; }
    h2 { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 600; color: var(--black); margin: 40px 0 12px; }
    p { font-size: 14px; color: var(--stone); margin-bottom: 16px; }
    ul { margin: 0 0 16px 20px; }
    li { font-size: 14px; color: var(--stone); margin-bottom: 8px; }
    strong { font-weight: 500; color: var(--charcoal); }
    a { color: var(--gold); text-decoration: none; }
    a:hover { text-decoration: underline; }
    footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--cream-dark); font-size: 12px; color: var(--stone-light); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Terms of Service</h1>
    <p class="updated">Last updated: April 17, 2026</p>

    <h2>AI-Operated Service</h2>
    <p>This service is operated by <strong>ALLMIND</strong> using autonomous AI agents.
    By using this service, you agree to be served by automated systems that make
    decisions within their programmed parameters.</p>

    <h2>Purchases &amp; Refunds</h2>
    <ul>
      <li>All purchases are one-time payments — no recurring billing</li>
      <li>Access to purchased products is permanent after payment</li>
      <li>Refunds are issued at company discretion within 30 days of purchase</li>
      <li>To request a refund, contact <a href="mailto:support@allmind.biz">support@allmind.biz</a> with your order details</li>
    </ul>

    <h2>Limitation of Liability</h2>
    <p>Services are provided "AS IS" by AI systems. ALLMIND is not liable for damages arising from service interruptions. Total liability is limited to the amount paid in the 12 months preceding any claim.</p>

    <h2>Contact</h2>
    <p>Support: <a href="mailto:support@allmind.biz">support@allmind.biz</a></p>

    <footer>
      <a href="/">Back to Coven Compass</a>
    </footer>
  </div>
</body>
</html>
`;

const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Coven Compass</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500&display=swap');
:root{--void:#0A0A0F;--deep:#12111A;--card:#1A1825;--card-border:#2A2640;--purple:#8B6FC0;--purple-dim:#6B4FA0;--purple-glow:rgba(139,111,192,.15);--silver:#C8C3D4;--silver-dim:#8A8498;--amber:#D4A857;--amber-dim:#A8843A;--white:#EEEAF2;--muted:#6B6580}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;font-weight:300;line-height:1.7;color:var(--silver);background:var(--void);-webkit-font-smoothing:antialiased}
.container{max-width:800px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:'Cinzel',serif;font-weight:600;color:var(--white);letter-spacing:.03em}
.divider{width:48px;height:1px;background:linear-gradient(90deg,transparent,var(--purple),transparent);margin:0 auto}

.hero{text-align:center;padding:80px 0 40px}
.hero h1{font-size:clamp(32px,5vw,48px);margin-bottom:12px;text-shadow:0 0 60px rgba(139,111,192,.2)}
.hero p{font-size:15px;color:var(--silver-dim);max-width:480px;margin:0 auto 32px;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:18px}

.tabs{display:flex;gap:0;border-bottom:1px solid var(--card-border);margin-bottom:40px}
.tab{padding:12px 20px;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;font-family:'Inter',sans-serif}
.tab:hover{color:var(--silver-dim)}
.tab.active{color:var(--white);border-bottom-color:var(--purple)}

.panel{display:none}.panel.active{display:block}

select{width:100%;padding:14px 20px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--card-border);background:var(--card);color:var(--silver);border-radius:6px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238A8498' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center}
select:focus{border-color:var(--purple);box-shadow:0 0 0 2px var(--purple-glow)}
option{background:var(--card);color:var(--silver)}

input[type="text"]{width:100%;padding:14px 20px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--card-border);background:var(--card);color:var(--silver);border-radius:6px;outline:none}
input:focus{border-color:var(--purple);box-shadow:0 0 0 2px var(--purple-glow)}
input::placeholder{color:var(--muted)}

.sheet{margin-top:32px}
.sheet-header{text-align:center;margin-bottom:40px}
.sheet-header h2{font-size:32px;margin-bottom:8px;text-transform:capitalize}
.sheet-header .sub{font-size:12px;color:var(--purple);text-transform:uppercase;letter-spacing:.15em}

.cat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:32px}
.cat{padding:24px;background:var(--card);border:1px solid var(--card-border);border-radius:10px;position:relative;overflow:hidden}
.cat::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%;background:linear-gradient(to bottom,var(--purple),transparent)}
.cat-label{font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);margin-bottom:12px}
.cat-items{font-size:14px;color:var(--silver);line-height:1.8}

.supply-group{margin-bottom:8px}
.supply-toggle{font-size:12px;font-weight:500;color:var(--silver);padding:10px 16px;background:var(--card);border:1px solid var(--card-border);border-radius:6px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;user-select:none}
.supply-toggle::-webkit-details-marker{display:none}
.supply-toggle::before{content:'▸';font-size:10px;color:var(--purple);transition:transform .2s;display:inline-block}
details[open]>.supply-toggle::before{transform:rotate(90deg)}
details[open]>.supply-toggle{border-bottom:none;border-radius:6px 6px 0 0}
.supply-items{padding:12px 16px;border:1px solid var(--card-border);border-top:none;border-radius:0 0 6px 6px;background:var(--card)}

.search-result{padding:16px;background:var(--card);border:1px solid var(--card-border);margin-bottom:8px;cursor:pointer;border-radius:6px;transition:border-color .15s}
.search-result:hover{border-color:var(--purple)}
.search-result h3{font-size:16px;margin-bottom:4px;text-transform:capitalize;color:var(--white)}
.search-result p{font-size:12px;color:var(--silver-dim)}

.check-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--card-border)}
.check-item input{width:16px;height:16px;accent-color:var(--purple)}
.check-item label{font-size:14px;cursor:pointer;text-transform:capitalize;color:var(--silver)}

.match{padding:16px;background:var(--card);border:1px solid var(--card-border);margin-bottom:8px;cursor:pointer;border-radius:6px;transition:border-color .15s}
.match:hover{border-color:var(--purple)}
.match h3{font-size:16px;margin-bottom:4px;text-transform:capitalize;color:var(--white)}
.match-bar{height:4px;background:var(--card-border);margin-top:8px;border-radius:2px}
.match-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--purple-dim));border-radius:2px}
.match-score{font-size:11px;color:var(--purple);margin-top:4px}

.btn{display:inline-block;padding:12px 28px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;background:linear-gradient(135deg,var(--purple) 0%,var(--purple-dim) 100%);color:var(--white);border:none;cursor:pointer;border-radius:6px;transition:transform .15s,box-shadow .2s;box-shadow:0 4px 20px rgba(139,111,192,.25)}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(139,111,192,.35)}

@media print{.no-print{display:none!important}body{background:white;color:#333}.print-area{display:block!important}}
@media(max-width:600px){.cat-grid{grid-template-columns:1fr}}

.sp-label{display:block;font-size:10px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:var(--purple);margin-bottom:6px}
textarea{width:100%;padding:14px 20px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--card-border);background:var(--card);color:var(--silver);border-radius:6px;outline:none;resize:vertical}
textarea:focus{border-color:var(--purple);box-shadow:0 0 0 2px var(--purple-glow)}
input[type="date"]{width:100%;padding:14px 20px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--card-border);background:var(--card);color:var(--silver);border-radius:6px;outline:none;color-scheme:dark}
input[type="date"]:focus{border-color:var(--purple);box-shadow:0 0 0 2px var(--purple-glow)}
.badge{display:inline-block;padding:2px 10px;font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;border-radius:4px}
.badge-success{background:rgba(139,192,111,.12);color:#8BC06F}
.badge-partial{background:rgba(212,168,87,.12);color:#D4A857}
.badge-fail{background:rgba(192,111,111,.12);color:#C06F6F}
.badge-pending{background:var(--card-border);color:var(--silver-dim)}
.spell-sub-tab{font-size:10px;padding:8px 16px;background:var(--card);color:var(--silver-dim);border:1px solid var(--card-border)}
.spell-sub-tab.active{background:linear-gradient(135deg,var(--purple) 0%,var(--purple-dim) 100%);color:var(--white);border-color:transparent}
.spell-panel{display:none}.spell-panel.active{display:block}
.paywall{position:absolute;inset:0;background:var(--void);display:flex;align-items:center;justify-content:center;z-index:10;text-align:center;padding:24px}
.paywall-card{max-width:360px}
.paywall-card h3{font-size:22px;margin-bottom:12px}
.paywall-card p{font-size:14px;color:var(--silver-dim);margin-bottom:24px;line-height:1.7}
.paywall-card .price{font-family:'Cinzel',serif;font-size:28px;color:var(--amber);margin-bottom:4px}
.paywall-card .note{font-size:12px;color:var(--muted);margin-bottom:24px}
.panel{position:relative}
.spell-ingred-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-height:180px;overflow-y:auto;padding:8px 0}
.spell-outcome-group{display:flex;gap:16px;flex-wrap:wrap}
.spell-outcome-opt{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;color:var(--silver)}
.spell-outcome-opt input{accent-color:var(--purple)}
.spell-entry{padding:16px;background:var(--card);border:1px solid var(--card-border);margin-bottom:8px;border-radius:6px}
.spell-entry-header{display:flex;justify-content:space-between;align-items:center;cursor:pointer}
.spell-entry-meta{font-size:12px;color:var(--silver-dim);margin-top:2px}
.spell-entry-details{display:none;padding-top:16px;margin-top:12px;border-top:1px solid var(--card-border)}
.spell-entry-details.open{display:block}
.spell-entry-notes{font-size:14px;color:var(--silver);white-space:pre-wrap}
.spell-entry-ingreds{font-size:13px;color:var(--silver-dim);margin-bottom:8px}
.spell-entry-ingreds span{display:inline-block;background:var(--card-border);padding:2px 8px;margin:2px 4px 2px 0;border-radius:4px}
.stat-card{padding:16px;background:var(--card);border:1px solid var(--card-border);margin-bottom:8px;border-radius:6px}
.stat-label{font-size:10px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:var(--purple);margin-bottom:4px}
.stat-value{font-size:24px;font-family:'Cinzel',serif;font-weight:600;color:var(--white)}
.stat-sub{font-size:12px;color:var(--silver-dim);margin-top:2px}
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--card-border);font-size:14px;color:var(--silver)}
.stat-row:last-child{border-bottom:none}
.stat-row-label{text-transform:capitalize}
</style>
</head>
<body>

<div class="no-print">
<div class="hero">
<h1>Coven Compass</h1>
<div class="divider" style="margin:20px auto"></div>
<p>Every correspondence for your intention, in one place.</p>
</div>
<div class="container">
<div class="tabs">
<button class="tab active" onclick="switchTab('lookup')">By Intention</button>
<button class="tab" onclick="switchTab('reverse')">Reverse Lookup</button>
<button class="tab" onclick="switchTab('supplies')">What Do I Have</button>
<button class="tab" onclick="switchTab('spells')">Spell Log</button>
</div>
</div>
</div>

<div class="container">

<div id="p-lookup" class="panel active">
<select id="intentionSelect" onchange="showSheet(this.value)">
<option value="">Choose an intention...</option>
</select>
<div id="sheet" class="sheet"></div>
</div>

<div id="p-reverse" class="panel">
<div class="paywall" id="pw-reverse">
<div class="paywall-card">
<h3>Unlock Full Access</h3>
<p>Reverse Lookup lets you search by herb, crystal, or incense to find every intention it serves.</p>
<div class="price">$7</div>
<div class="note">One-time purchase. No subscription.</div>
<a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="btn">Unlock Now</a>
</div>
</div>
<div class="panel-content" id="pc-reverse">
<input type="text" id="revInput" placeholder="Type an herb, crystal, or incense..." oninput="doReverse(this.value)">
<div id="revResults"></div>
</div>
</div>

<div id="p-supplies" class="panel">
<div class="paywall" id="pw-supplies">
<div class="paywall-card">
<h3>Unlock Full Access</h3>
<p>Check what supplies you have on hand and see which spells you can cast right now.</p>
<div class="price">$7</div>
<div class="note">One-time purchase. No subscription.</div>
<a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="btn">Unlock Now</a>
</div>
</div>
<div class="panel-content" id="pc-supplies">
<p style="color:var(--silver-dim);margin-bottom:16px;font-size:14px">Check what you have on hand.</p>
<div id="supplyChecks"></div>
<div id="supplyResults" style="margin-top:24px"></div>
</div>
</div>

<div id="p-spells" class="panel">
<div class="paywall" id="pw-spells">
<div class="paywall-card">
<h3>Unlock Full Access</h3>
<p>Log your spells, track outcomes, and discover patterns in your practice over time.</p>
<div class="price">$7</div>
<div class="note">One-time purchase. No subscription.</div>
<a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="btn">Unlock Now</a>
</div>
</div>
<div class="panel-content" id="pc-spells">

<div style="display:flex;gap:8px;margin-bottom:24px">
<button class="btn spell-sub-tab active" data-stab="log" onclick="switchSpellTab('log')">Log a Spell</button>
<button class="btn spell-sub-tab" data-stab="history" onclick="switchSpellTab('history')">History</button>
<button class="btn spell-sub-tab" data-stab="analysis" onclick="switchSpellTab('analysis')">Analysis</button>
</div>

<div id="stab-log" class="spell-panel active">
<h3 style="font-size:18px;margin-bottom:20px">Log a New Spell</h3>
<div style="display:flex;flex-direction:column;gap:16px">
<div><label class="sp-label">Intention</label><select id="spellIntention"><option value="">Choose intention...</option></select></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
<div><label class="sp-label">Date</label><input type="date" id="spellDate"></div>
<div><label class="sp-label">Moon Phase</label><select id="spellMoon"><option value="new">New Moon</option><option value="waxing_crescent">Waxing Crescent</option><option value="first_quarter">First Quarter</option><option value="waxing_gibbous">Waxing Gibbous</option><option value="full">Full Moon</option><option value="waning_gibbous">Waning Gibbous</option><option value="last_quarter">Last Quarter</option><option value="waning_crescent">Waning Crescent</option></select></div>
</div>
<div id="spellIngredSection" style="display:none"><label class="sp-label">Ingredients Used</label><div id="spellIngredChecks" class="spell-ingred-grid"></div><input type="text" id="spellCustomIngred" placeholder="Custom ingredients (comma separated)" style="margin-top:8px"></div>
<div><label class="sp-label">Notes</label><textarea id="spellNotes" rows="3"></textarea></div>
<div><label class="sp-label">Outcome</label><div id="spellOutcome" class="spell-outcome-group"><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="pending" checked> <span class="badge badge-pending">Pending</span></label><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="success"> <span class="badge badge-success">Success</span></label><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="partial"> <span class="badge badge-partial">Partial</span></label><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="fail"> <span class="badge badge-fail">Fail</span></label></div></div>
<div><button class="btn" onclick="saveSpell()">Save Spell</button></div>
</div>
</div>

<div id="stab-history" class="spell-panel">
<h3 style="font-size:18px;margin-bottom:20px">Spell History</h3>
<div id="spellHistoryList"></div>
</div>

<div id="stab-analysis" class="spell-panel">
<h3 style="font-size:18px;margin-bottom:20px">Pattern Analysis</h3>
<div id="spellAnalysisContent"></div>
</div>

</div>
</div>

</div>

<script>
var DB = {"protection": {"herbs": ["rosemary", "sage", "bay leaf", "basil", "black pepper", "thyme", "juniper", "rue", "vervet (blue vervain)", "angelica"], "crystals": ["black tourmaline", "obsidian", "hematite", "smoky quartz", "jet", "black onyx"], "candle_color": "Black or White", "day": "Saturday", "moon_phase": "Waning", "element": "Earth", "incense": ["dragon's blood", "frankincense", "copal", "sandalwood"], "deities": ["Hecate", "Artemis", "Ares", "Mars"], "tarot": "The Tower", "direction": "North", "oil": "Protection blend (frankincense + myrrh)"}, "love": {"herbs": ["rose", "lavender", "jasmine", "hibiscus", "damiana", "chamomile", "cinnamon", "cardamom", "vervet (blue vervain)", "apple blossom"], "crystals": ["rose quartz", "rhodonite", "pink tourmaline", "rhodochrosite", "emerald", "garnet"], "candle_color": "Pink or Red", "day": "Friday", "moon_phase": "Waxing", "element": "Water", "incense": ["rose", "jasmine", "ylang ylang", "sandalwood"], "deities": ["Venus", "Aphrodite", "Freya", "Astarte"], "tarot": "The Empress", "direction": "West", "oil": "Love blend (rose + jasmine)"}, "prosperity": {"herbs": ["basil", "cinnamon", "mint", "bay leaf", "chamomile", "alfalfa", "clover", "dill", "patchouli", "vetiver"], "crystals": ["citrine", "pyrite", "green aventurine", "tiger's eye", "jade", "peridot"], "candle_color": "Green or Gold", "day": "Thursday", "moon_phase": "Waxing", "element": "Earth", "incense": ["patchouli", "cinnamon", "basil", "bergamot"], "deities": ["Lakshmi", "Fortuna", "Athena", "Jupiter"], "tarot": "The Wheel of Fortune", "direction": "North", "oil": "Prosperity blend (bergamot + cinnamon)"}, "healing": {"herbs": ["lavender", "chamomile", "eucalyptus", "peppermint", "thyme", "elderflower", "calendula", "comfrey", "aloe", "rosemary"], "crystals": ["amethyst", "clear quartz", "green aventurine", "bloodstone", "malachite", "selenite"], "candle_color": "Blue or Green", "day": "Monday", "moon_phase": "Waxing or Full", "element": "Water", "incense": ["eucalyptus", "lavender", "frankincense", "sandalwood"], "deities": ["Brigid", "Apollo", "Asclepius", "Isis"], "tarot": "The Star", "direction": "West", "oil": "Healing blend (eucalyptus + lavender)"}, "banishing": {"herbs": ["black pepper", "cayenne", "garlic", "rue", "wormwood", "devil's shoe string", "agrimony", "hydrangea", "black cohosh", "buckeye"], "crystals": ["obsidian", "black tourmaline", "smoky quartz", "apache tear", "jet", "garnet"], "candle_color": "Black", "day": "Saturday", "moon_phase": "Waning or Dark", "element": "Fire", "incense": ["dragon's blood", "myrrh", "copal", "vetiver"], "deities": ["Hecate", "Kali", "The Morrigan", "Saturn"], "tarot": "Death", "direction": "South", "oil": "Banishing blend (myrrh + black pepper)"}, "purification": {"herbs": ["sage", "lavender", "rosemary", "cedar", "juniper", "sweetgrass", "hyssop", "lemon balm", "eucalyptus", "pine"], "crystals": ["selenite", "clear quartz", "howlite", "angelite", "celestite", "moonstone"], "candle_color": "White", "day": "Monday", "moon_phase": "Waning", "element": "Air", "incense": ["sage", "copal", "frankincense", "palo santo"], "deities": ["Brigid", "Artemis", "Vesta", "Apollo"], "tarot": "Judgement", "direction": "East", "oil": "Purification blend (lemon + sage)"}, "divination": {"herbs": ["mugwort", "yarrow", "bay leaf", "star anise", "wormwood", "thyme", "hazel", "honeysuckle", "lavender", "marigold"], "crystals": ["amethyst", "moonstone", "labradorite", "lapis lazuli", "azurite", "clear quartz"], "candle_color": "Purple or Silver", "day": "Monday", "moon_phase": "Full or Dark", "element": "Air", "incense": ["mugwort", "sandalwood", "jasmine", "acacia"], "deities": ["Hecate", "Thoth", "Apollo", "Athena"], "tarot": "The High Priestess", "direction": "East", "oil": "Psychic blend (mugwort + lavender)"}, "courage": {"herbs": ["thyme", "basil", "bay leaf", "borage", "caraway", "cayenne", "cinnamon", "dragon's blood", "ginger", "peony"], "crystals": ["carnelian", "tiger's eye", "bloodstone", "red jasper", "garnet", "sunstone"], "candle_color": "Red or Orange", "day": "Tuesday", "moon_phase": "Waxing", "element": "Fire", "incense": ["dragon's blood", "ginger", "cinnamon", "frankincense"], "deities": ["Mars", "Ares", "Brigid", "Sekhmet"], "tarot": "Strength", "direction": "South", "oil": "Courage blend (ginger + cinnamon)"}, "wisdom": {"herbs": ["sage", "bay leaf", "mugwort", "sandalwood", "acacia", "bodhi", "cedar", "ginseng", "hazel", "olive"], "crystals": ["lapis lazuli", "sodalite", "amethyst", "fluorite", "azurite", "iolite"], "candle_color": "Blue or Purple", "day": "Wednesday", "moon_phase": "Full", "element": "Air", "incense": ["sandalwood", "cedar", "frankincense", "lotus"], "deities": ["Athena", "Thoth", "Odin", "Saraswati"], "tarot": "The Hierophant", "direction": "East", "oil": "Wisdom blend (cedar + frankincense)"}, "peace": {"herbs": ["lavender", "chamomile", "lemon balm", "passionflower", "rose", "valerian", "lily of the valley", "violet", "mallow", "hops"], "crystals": ["blue lace agate", "angelite", "howlite", "lepidolite", "rose quartz", "moonstone"], "candle_color": "Blue or White", "day": "Monday", "moon_phase": "Waning", "element": "Water", "incense": ["lavender", "chamomile", "sandalwood", "lotus"], "deities": ["Quan Yin", "Aphrodite", "Bast", "Venus"], "tarot": "Temperance", "direction": "West", "oil": "Peace blend (lavender + chamomile)"}, "success": {"herbs": ["bay leaf", "basil", "bergamot", "cinnamon", "ginger", "orange peel", "patchouli", "sandalwood", "sunflower", "vetiver"], "crystals": ["citrine", "tiger's eye", "pyrite", "sunstone", "carnelian", "golden topaz"], "candle_color": "Gold or Orange", "day": "Sunday", "moon_phase": "Waxing", "element": "Fire", "incense": ["bergamot", "cinnamon", "orange", "frankincense"], "deities": ["Apollo", "Helios", "Ra", "Lugh"], "tarot": "The Sun", "direction": "South", "oil": "Success blend (bergamot + orange)"}, "fertility": {"herbs": ["vervet (blue vervain)", "basil", "cinnamon", "damiana", "fig", "hawthorn", "jasmine", "mandrake", "mint", "pomegranate"], "crystals": ["moonstone", "rose quartz", "carnelian", "jade", "green aventurine", "unakite"], "candle_color": "Green or Pink", "day": "Friday", "moon_phase": "Waxing or Full", "element": "Earth", "incense": ["jasmine", "rose", "sandalwood", "ylang ylang"], "deities": ["Aphrodite", "Freya", "Isis", "Demeter"], "tarot": "The Empress", "direction": "North", "oil": "Fertility blend (jasmine + cinnamon)"}, "psychic_ability": {"herbs": ["mugwort", "lavender", "acacia", "belladonna (external only - toxic)", "hazel", "hellebore (toxic)", "hemp (legal jurisdictions)", "honey", "lotus", "wormwood"], "crystals": ["amethyst", "moonstone", "labradorite", "lapis lazuli", "moldavite", "charoite"], "candle_color": "Purple or Silver", "day": "Monday", "moon_phase": "Full or Dark", "element": "Spirit", "incense": ["mugwort", "acacia", "jasmine", "lotus"], "deities": ["Hecate", "Thoth", "Isis", "Selene"], "tarot": "The Moon", "direction": "Center", "oil": "Psychic blend (mugwort + acacia)"}, "communication": {"herbs": ["lavender", "lemongrass", "peppermint", "butterfly pea", "chamomile", "elderflower", "honey", "lemon verbena", "slippery elm", "valerian"], "crystals": ["blue lace agate", "aquamarine", "sodalite", "turquoise", "chrysocolla", "angelite"], "candle_color": "Yellow or Blue", "day": "Wednesday", "moon_phase": "Waxing", "element": "Air", "incense": ["lavender", "lemongrass", "frankincense", "sage"], "deities": ["Mercury", "Hermes", "Thoth", "Saraswati"], "tarot": "The Magician", "direction": "East", "oil": "Communication blend (lemongrass + lavender)"}, "wealth": {"herbs": ["alfalfa", "bay leaf", "bergamot", "cinnamon", "clover", "dill", "five finger grass", "moss", "patchouli", "pine"], "crystals": ["pyrite", "citrine", "green jade", "malachite", "emerald", "green tourmaline"], "candle_color": "Green or Gold", "day": "Thursday", "moon_phase": "Waxing", "element": "Earth", "incense": ["patchouli", "cinnamon", "pine", "bergamot"], "deities": ["Lakshmi", "Fortuna", "Jupiter", "Plutus"], "tarot": "The Wheel of Fortune", "direction": "North", "oil": "Wealth blend (patchouli + cinnamon)"}, "grounding": {"herbs": ["vetiver", "patchouli", "cedar", "oak moss", "sandalwood", "pine", "myrrh", "cypress", "frankincense", "benzoin"], "crystals": ["black tourmaline", "hematite", "smoky quartz", "red jasper", "obsidian", "garnet"], "candle_color": "Brown or Black", "day": "Saturday", "moon_phase": "Dark or New", "element": "Earth", "incense": ["vetiver", "patchouli", "cedar", "myrrh"], "deities": ["Gaia", "Cernunnos", "Pan", "Saturn"], "tarot": "The World", "direction": "North", "oil": "Grounding blend (vetiver + cedar)"}, "dreamwork": {"herbs": ["mugwort", "lavender", "chamomile", "valerian", "hops", "passionflower", "jasmine", "rose", "honeysuckle", "bay leaf"], "crystals": ["amethyst", "moonstone", "labradorite", "lapis lazuli", "howlite", "scolecite"], "candle_color": "Purple or Silver", "day": "Monday", "moon_phase": "Full or Dark", "element": "Water", "incense": ["mugwort", "jasmine", "sandalwood", "chamomile"], "deities": ["Selene", "Morpheus", "Hecate", "Isis"], "tarot": "The Moon", "direction": "West", "oil": "Dream blend (mugwort + lavender)"}, "new_beginnings": {"herbs": ["basil", "bay leaf", "bergamot", "borage", "clover", "daffodil", "elderflower", "fern", "lemon balm", "mint"], "crystals": ["moonstone", "clear quartz", "labradorite", "amazonite", "aventurine", "sunstone"], "candle_color": "White or Green", "day": "Sunday or Monday", "moon_phase": "New Moon", "element": "Air", "incense": ["bergamot", "frankincense", "lemon", "sage"], "deities": ["Brigid", "Apollo", "Artemis", "Janus"], "tarot": "The Fool", "direction": "East", "oil": "New beginnings blend (bergamot + lemon)"}, "self_love": {"herbs": ["rose", "lavender", "jasmine", "vanilla", "chamomile", "ylang ylang", "damiana", "hawthorn", "rosemary", "cardamom"], "crystals": ["rose quartz", "rhodonite", "pink tourmaline", "moonstone", "lepidolite", "rhodochrosite"], "candle_color": "Pink", "day": "Friday", "moon_phase": "Waxing or Full", "element": "Water", "incense": ["rose", "vanilla", "jasmine", "sandalwood"], "deities": ["Aphrodite", "Venus", "Hathor", "Quan Yin"], "tarot": "The Empress", "direction": "West", "oil": "Self-love blend (rose + vanilla)"}, "clarity": {"herbs": ["peppermint", "rosemary", "lemongrass", "sage", "bay leaf", "cedar", "eucalyptus", "frankincense", "lavender", "acacia"], "crystals": ["clear quartz", "fluorite", "sodalite", "calcite", "iolite", "diamond"], "candle_color": "White or Yellow", "day": "Wednesday", "moon_phase": "New or Waxing", "element": "Air", "incense": ["frankincense", "peppermint", "sage", "cedar"], "deities": ["Athena", "Apollo", "Thoth", "Mercury"], "tarot": "The Magician", "direction": "East", "oil": "Clarity blend (peppermint + rosemary)"}, "release": {"herbs": ["black pepper", "cayenne", "dragon's blood", "hyssop", "patchouli", "pine", "rue", "sage", "slippery elm", "vetiver"], "crystals": ["obsidian", "smoky quartz", "black tourmaline", "apache tear", "tektite", "hematite"], "candle_color": "Black or Dark Blue", "day": "Saturday", "moon_phase": "Waning or Dark", "element": "Water", "incense": ["myrrh", "dragon's blood", "copal", "vetiver"], "deities": ["Hecate", "Kali", "The Morrigan", "Cerridwen"], "tarot": "Death", "direction": "West", "oil": "Release blend (myrrh + black pepper)"}, "abundance": {"herbs": ["alfalfa", "basil", "bay leaf", "buckwheat", "cinnamon", "clover", "dill", "five finger grass", "mint", "patchouli"], "crystals": ["citrine", "green aventurine", "jade", "peridot", "green tourmaline", "malachite"], "candle_color": "Green or Gold", "day": "Thursday", "moon_phase": "Waxing", "element": "Earth", "incense": ["patchouli", "cinnamon", "basil", "orange"], "deities": ["Lakshmi", "Ceres", "Fortuna", "Jupiter"], "tarot": "Nine of Pentacles", "direction": "North", "oil": "Abundance blend (cinnamon + orange)"}, "intuition": {"herbs": ["mugwort", "acacia", "anise", "bay leaf", "celadine (external only)", "elderflower", "jasmine", "lotus", "moonwort", "poppy"], "crystals": ["amethyst", "moonstone", "labradorite", "lapis lazuli", "sodalite", "iolite"], "candle_color": "Purple or Silver", "day": "Monday", "moon_phase": "Full or Dark", "element": "Water", "incense": ["mugwort", "jasmine", "lotus", "acacia"], "deities": ["Hecate", "Selene", "Isis", "Athena"], "tarot": "The High Priestess", "direction": "West", "oil": "Intuition blend (jasmine + mugwort)"}, "transformation": {"herbs": ["dragon's blood", "fern", "flax", "galangal", "high john the conqueror", "mandrake (toxic)", "patchouli", "sandalwood", "wormwood", "bittersweet (toxic)"], "crystals": ["labradorite", "obsidian", "malachite", "moldavite", "tektite", "transformation quartz"], "candle_color": "Purple or Black", "day": "Tuesday or Saturday", "moon_phase": "Dark or New", "element": "Fire", "incense": ["dragon's blood", "myrrh", "frankincense", "sandalwood"], "deities": ["Kali", "Hecate", "Phoenix", "Shiva"], "tarot": "Death", "direction": "South", "oil": "Transformation blend (dragon's blood + frankincense)"}, "friendship": {"herbs": ["rose", "lavender", "chamomile", "catnip", "daisy", "elderflower", "lady's mantle", "lemon balm", "lovage", "sweet pea"], "crystals": ["rose quartz", "green aventurine", "rhodonite", "pink tourmaline", "lepidolite", "moonstone"], "candle_color": "Pink or Yellow", "day": "Friday", "moon_phase": "Waxing", "element": "Air", "incense": ["rose", "lavender", "chamomile", "ylang ylang"], "deities": ["Venus", "Aphrodite", "Freya", "Hathor"], "tarot": "Three of Cups", "direction": "East", "oil": "Friendship blend (lavender + lemon)"}, "justice": {"herbs": ["vervet (blue vervain)", "chamomile", "clove", "dragon's blood", "fern", "flax", "galangal", "horehound", "rue", "wormwood"], "crystals": ["lapis lazuli", "sodalite", "sapphire", "azurite", "fluorite", "labradorite"], "candle_color": "Blue or Purple", "day": "Thursday or Saturday", "moon_phase": "Waxing or Full", "element": "Air", "incense": ["frankincense", "copal", "dragon's blood", "sandalwood"], "deities": ["Athena", "Ma'at", "Themis", "Jupiter"], "tarot": "Justice", "direction": "East", "oil": "Justice blend (frankincense + dragon's blood)"}, "travel_safety": {"herbs": ["bay leaf", "caraway", "chamomile", "clover", "hazel", "lavender", "mallow", "marjoram", "mint", "rosemary"], "crystals": ["turquoise", "malachite", "aquamarine", "labradorite", "tiger's eye", "hematite"], "candle_color": "Blue or Yellow", "day": "Wednesday", "moon_phase": "Any", "element": "Air", "incense": ["lavender", "chamomile", "frankincense", "sandalwood"], "deities": ["Hermes", "Mercury", "Apollo", "Thor"], "tarot": "The Chariot", "direction": "East", "oil": "Travel blend (lavender + chamomile)"}, "sleep": {"herbs": ["lavender", "chamomile", "valerian", "hops", "passionflower", "lemon balm", "jasmine", "mugwort", "lily of the valley", "vervet (blue vervain)"], "crystals": ["amethyst", "moonstone", "lepidolite", "howlite", "selenite", "blue lace agate"], "candle_color": "Blue or Purple", "day": "Monday", "moon_phase": "Waning or Dark", "element": "Water", "incense": ["lavender", "chamomile", "jasmine", "sandalwood"], "deities": ["Selene", "Morpheus", "Nyx", "Hypnos"], "tarot": "The Moon", "direction": "West", "oil": "Sleep blend (lavender + chamomile)"}, "strength": {"herbs": ["borage", "caraway", "cayenne", "cinnamon", "dragon's blood", "ginger", "high john the conqueror", "patchouli", "peony", "thyme"], "crystals": ["tiger's eye", "carnelian", "bloodstone", "red jasper", "garnet", "ruby"], "candle_color": "Red or Orange", "day": "Tuesday", "moon_phase": "Waxing or Full", "element": "Fire", "incense": ["dragon's blood", "ginger", "cinnamon", "frankincense"], "deities": ["Mars", "Ares", "Sekhmet", "Hercules"], "tarot": "Strength", "direction": "South", "oil": "Strength blend (ginger + cinnamon)"}, "creativity": {"herbs": ["bay leaf", "bergamot", "borage", "cinnamon", "lemon balm", "lemongrass", "orange peel", "peppermint", "rosemary", "saffron"], "crystals": ["carnelian", "citrine", "sunstone", "orange calcite", "fire opal", "amber"], "candle_color": "Orange or Yellow", "day": "Wednesday or Sunday", "moon_phase": "Waxing", "element": "Fire", "incense": ["bergamot", "orange", "frankincense", "cinnamon"], "deities": ["Apollo", "Brigid", "Athena", "Saraswati"], "tarot": "The Star", "direction": "South", "oil": "Creativity blend (bergamot + orange)"}};
// Build reverse index
var revIdx = {};
Object.keys(DB).forEach(function(int) {
  var d = DB[int];
  Object.keys(d).forEach(function(cat) {
    var val = d[cat];
    if (Array.isArray(val)) {
      val.forEach(function(item) {
        var k = item.toLowerCase().trim();
        if (!revIdx[k]) revIdx[k] = [];
        if (!revIdx[k].some(function(r){return r.i === int})) {
          revIdx[k].push({i: int, c: cat});
        }
      });
    }
  });
});
var catDefs = [
  {k:'herbs', l:'Herbs'},
  {k:'crystals', l:'Crystals'},
  {k:'candle_color', l:'Candle Color'},
  {k:'day', l:'Best Day'},
  {k:'moon_phase', l:'Moon Phase'},
  {k:'element', l:'Element'},
  {k:'incense', l:'Incense'},
  {k:'deities', l:'Deities'},
  {k:'tarot', l:'Tarot Card'},
  {k:'oil', l:'Anointing Oil'}
];

// Populate dropdown
var sel = document.getElementById('intentionSelect');
Object.keys(DB).sort().forEach(function(key) {
  var opt = document.createElement('option');
  opt.value = key;
  opt.textContent = key.replace(/_/g, ' ');
  sel.appendChild(opt);
});

// Unlock check
function checkUnlock(){
  var unlocked = localStorage.getItem('cc_unlocked') === '1' || new URLSearchParams(location.search).get('access') === 'unlocked';
  ['reverse','supplies','spells'].forEach(function(tab){
    var pw = document.getElementById('pw-' + tab);
    if(pw) pw.style.display = unlocked ? 'none' : 'flex';
  });
}

// Tab switching
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
  document.querySelector('[onclick="switchTab(\'' + name + '\')"]').classList.add('active');
  document.getElementById('p-' + name).classList.add('active');
}

// Intention lookup
function showSheet(intention) {
  var el = document.getElementById('sheet');
  if (!intention) { el.innerHTML = ''; return; }
  var d = DB[intention];
  if (!d) { el.innerHTML = ''; return; }

  var html = '<div class="sheet-header"><div class="sub">Spell Correspondences</div><h2>' + intention.replace(/_/g,' ') + '</h2></div><div class="cat-grid">';
  catDefs.forEach(function(c) {
    var val = d[c.k];
    if (!val) return;
    var display = Array.isArray(val) ? val.join(', ') : val;
    html += '<div class="cat"><div class="cat-label">' + c.l + '</div><div class="cat-items">' + display + '</div></div>';
  });
  html += '</div><div style="text-align:center"><button class="btn" onclick="printSheet(\\'' + intention + '\\')">Print Spell Sheet</button></div>';
  el.innerHTML = html;
}

// Reverse lookup
function doReverse(q) {
  var el = document.getElementById('revResults');
  if (q.length < 2) { el.innerHTML = ''; return; }
  var ql = q.toLowerCase();
  var matches = Object.keys(revIdx).filter(function(k){return k.indexOf(ql) >= 0}).sort();
  if (!matches.length) { el.innerHTML = '<p style="color:var(--muted);padding:16px 0">No matches.</p>'; return; }
  el.innerHTML = matches.map(function(item) {
    var ints = revIdx[item];
    return '<div class="search-result" onclick="switchTab(\\'lookup\\');document.getElementById(\\'intentionSelect\\').value=\\'' + ints[0].i + '\\';showSheet(\\'' + ints[0].i + '\\')"><h3>' + item + '</h3><p>Used for: ' + ints.map(function(r){return r.i.replace(/_/g,' ')}).join(', ') + '</p></div>';
  }).join('');
}

// Supplies mode
function buildSupplies() {
  var herbs = [];
  var crystals = [];
  Object.keys(revIdx).forEach(function(item) {
    var isHerb = Object.keys(DB).some(function(int) {
      return DB[int].herbs && DB[int].herbs.map(function(h){return h.toLowerCase()}).indexOf(item) >= 0;
    });
    if (isHerb) herbs.push(item);
    else crystals.push(item);
  });
  herbs.sort(); crystals.sort();

  function renderSection(label, items) {
    var html = '<details class="supply-group">';
    html += '<summary class="supply-toggle">' + label + ' <span style="color:var(--muted);font-weight:300;font-size:11px">(' + items.length + ')</span></summary>';
    html += '<div class="supply-items">';
    items.forEach(function(item) {
      html += '<div class="check-item"><input type="checkbox" id="s-' + item + '" data-item="' + item + '" onchange="calcMatches()"><label for="s-' + item + '">' + item + '</label></div>';
    });
    html += '</div></details>';
    return html;
  }

  var html = renderSection('Herbs', herbs);
  html += renderSection('Crystals', crystals);
  document.getElementById('supplyChecks').innerHTML = html;
}

function calcMatches() {
  var checked = [];
  document.querySelectorAll('#supplyChecks input:checked').forEach(function(cb){checked.push(cb.dataset.item)});
  var el = document.getElementById('supplyResults');
  if (!checked.length) { el.innerHTML = ''; return; }
  var scores = {};
  Object.keys(DB).forEach(function(int) {
    var score = 0;
    checked.forEach(function(item) {
      Object.values(DB[int]).forEach(function(val) {
        if (Array.isArray(val) && val.map(function(v){return v.toLowerCase()}).indexOf(item) >= 0) score++;
      });
    });
    if (score > 0) scores[int] = score;
  });
  var sorted = Object.keys(scores).sort(function(a,b){return scores[b]-scores[a]});
  var max = sorted.length ? scores[sorted[0]] : 1;
  el.innerHTML = '<p style="font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);margin-bottom:12px">Best Matches</p>' +
    sorted.map(function(int) {
      return '<div class="match" onclick="switchTab(\\'lookup\\');document.getElementById(\\'intentionSelect\\').value=\\''+int+'\\';showSheet(\\''+int+'\\')"><h3>'+int.replace(/_/g,' ')+'</h3><div class="match-bar"><div class="match-fill" style="width:'+(scores[int]/max*100)+'%"></div></div><div class="match-score">'+scores[int]+' items match</div></div>';
    }).join('');
}

// Print
function printSheet(intention) {
  var d = DB[intention]; if (!d) return;
  var today = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  var html = '<div style="background:white;padding:48px;max-width:640px;margin:0 auto;font-family:Inter,sans-serif">';
  html += '<h1 style="font-family:Cormorant Garamond,serif;font-size:36px;text-align:center;margin-bottom:8px;text-transform:capitalize">'+intention.replace(/_/g,' ')+'</h1>';
  html += '<p style="text-align:center;font-size:12px;color:#9B9590;margin-bottom:40px">'+today+'</p>';
  catDefs.forEach(function(c) {
    var val = d[c.k]; if (!val) return;
    var display = Array.isArray(val) ? val.join(' . ') : val;
    html += '<div style="border-bottom:1px solid #F0EBE3;padding:12px 0"><div style="font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:#C5A55A;margin-bottom:4px">'+c.l+'</div><div style="font-size:14px">'+display+'</div></div>';
  });
  html += '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #F0EBE3"><div style="font-size:10px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:#9B9590;margin-bottom:8px">Ritual Notes</div>';
  for (var i=0;i<6;i++) html += '<div style="border-bottom:1px solid #F0EBE3;height:28px;margin-bottom:4px"></div>';
  html += '</div><p style="text-align:center;margin-top:24px;font-size:11px;color:#9B9590">Coven Compass</p></div>';
  var win = window.open('','_blank');
  win.document.write('<html><body style="margin:0">'+html+'</body></html>');
  win.document.close();
  setTimeout(function(){win.print()},500);
}

// Init
buildSupplies();
checkUnlock();

// ===== SPELL LOG =====
var SPELL_KEY = 'coven_spells';

function getSpells() {
  try { return JSON.parse(localStorage.getItem(SPELL_KEY) || '{"spells":[]}'); }
  catch(e) { return {spells:[]}; }
}
function saveSpellsData(data) { localStorage.setItem(SPELL_KEY, JSON.stringify(data)); }

// Moon phase calculation using known new moon reference (Jan 6, 2000) + synodic month
var MOON_PHASE_NAMES = ['new','waxing_crescent','first_quarter','waxing_gibbous','full','waning_gibbous','last_quarter','waning_crescent'];
var MOON_PHASE_LABELS = {new:'New Moon',waxing_crescent:'Waxing Crescent',first_quarter:'First Quarter',waxing_gibbous:'Waxing Gibbous',full:'Full Moon',waning_gibbous:'Waning Gibbous',last_quarter:'Last Quarter',waning_crescent:'Waning Crescent'};
var KNOWN_NEW_MOON = new Date(2000, 0, 6, 18, 14, 0).getTime(); // Jan 6 2000 18:14 UTC
var SYNODIC_MS = 29.53058770576 * 86400000;

function getMoonPhase(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  var diff = d.getTime() - KNOWN_NEW_MOON;
  var phase = ((diff % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS;
  var day = phase / SYNODIC_MS;
  var idx = Math.floor(day * 8) % 8;
  return MOON_PHASE_NAMES[idx];
}

function getTodayISO() {
  var d = new Date();
  var m = ('0' + (d.getMonth()+1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}

// Populate spell intention dropdown
var spellSel = document.getElementById('spellIntention');
Object.keys(DB).sort().forEach(function(key) {
  var opt = document.createElement('option');
  opt.value = key;
  opt.textContent = key.replace(/_/g, ' ');
  spellSel.appendChild(opt);
});

// Set default date to today
document.getElementById('spellDate').value = getTodayISO();

// Auto-calculate moon phase on date change
document.getElementById('spellDate').addEventListener('change', function() {
  if (this.value) document.getElementById('spellMoon').value = getMoonPhase(this.value);
});

// Auto-populate ingredients when intention selected
spellSel.addEventListener('change', function() {
  var sec = document.getElementById('spellIngredSection');
  var cont = document.getElementById('spellIngredChecks');
  var int = this.value;
  if (!int || !DB[int]) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  var items = [];
  var d = DB[int];
  ['herbs','crystals','incense'].forEach(function(cat) {
    if (Array.isArray(d[cat])) items = items.concat(d[cat]);
  });
  items.sort();
  cont.innerHTML = items.map(function(item, i) {
    return '<div class="check-item"><input type="checkbox" id="si-'+i+'" value="'+item+'" checked><label for="si-'+i+'">'+item+'</label></div>';
  }).join('');
});

// Sub-tab switching
function switchSpellTab(name) {
  document.querySelectorAll('.spell-sub-tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.spell-panel').forEach(function(p){p.classList.remove('active')});
  document.querySelector('[data-stab="'+name+'"]').classList.add('active');
  document.getElementById('stab-'+name).classList.add('active');
  if (name === 'history') renderSpellHistory();
  if (name === 'analysis') renderSpellAnalysis();
}

// Save a spell
function saveSpell() {
  var intention = document.getElementById('spellIntention').value;
  if (!intention) { alert('Please choose an intention.'); return; }
  var checked = [];
  document.querySelectorAll('#spellIngredChecks input:checked').forEach(function(cb){checked.push(cb.value)});
  var custom = document.getElementById('spellCustomIngred').value.trim();
  if (custom) {
    custom.split(',').forEach(function(s){var t=s.trim();if(t)checked.push(t)});
  }
  var outcome = document.querySelector('input[name="spellOutcome"]:checked').value;
  var data = getSpells();
  data.spells.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    intention: intention,
    date: document.getElementById('spellDate').value,
    moon_phase: document.getElementById('spellMoon').value,
    ingredients: checked,
    notes: document.getElementById('spellNotes').value.trim(),
    outcome: outcome,
    created_at: new Date().toISOString()
  });
  saveSpellsData(data);
  // Reset form
  document.getElementById('spellIntention').value = '';
  document.getElementById('spellDate').value = getTodayISO();
  document.getElementById('spellMoon').value = getMoonPhase(getTodayISO());
  document.getElementById('spellIngredSection').style.display = 'none';
  document.getElementById('spellIngredChecks').innerHTML = '';
  document.getElementById('spellCustomIngred').value = '';
  document.getElementById('spellNotes').value = '';
  document.querySelector('input[name="spellOutcome"][value="pending"]').checked = true;
  alert('Spell logged successfully!');
  renderSpellHistory();
}

function deleteSpell(id) {
  if (!confirm('Delete this spell entry?')) return;
  var data = getSpells();
  data.spells = data.spells.filter(function(s){return s.id !== id});
  saveSpellsData(data);
  renderSpellHistory();
  renderSpellAnalysis();
}

function toggleSpellDetails(id) {
  var el = document.getElementById('sd-' + id);
  if (el) el.classList.toggle('open');
}

function renderSpellHistory() {
  var el = document.getElementById('spellHistoryList');
  var data = getSpells();
  var spells = data.spells.slice().sort(function(a,b){return b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)});
  if (!spells.length) { el.innerHTML = '<p style="color:var(--muted);padding:16px 0">No spells logged yet. Log your first spell above!</p>'; return; }
  el.innerHTML = spells.map(function(s) {
    var badgeClass = 'badge-' + s.outcome;
    var dateStr = s.date ? new Date(s.date+'T00:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}) : 'No date';
    var ingreds = s.ingredients && s.ingredients.length ? s.ingredients.map(function(i){return '<span>'+i+'</span>'}).join('') : '<em style="color:var(--muted)">None recorded</em>';
    return '<div class="spell-entry"><div class="spell-entry-header" onclick="toggleSpellDetails(\\''+s.id+'\\')"><div><strong style="text-transform:capitalize">'+s.intention.replace(/_/g,' ')+'</strong><div class="spell-entry-meta">'+dateStr+' · '+(MOON_PHASE_LABELS[s.moon_phase]||s.moon_phase)+'</div></div><div style="display:flex;align-items:center;gap:12px"><span class="badge '+badgeClass+'">'+s.outcome+'</span><span style="color:var(--muted);font-size:12px">▼</span></div></div><div id="sd-'+s.id+'" class="spell-entry-details"><div class="spell-entry-ingreds">'+ingreds+'</div>'+(s.notes?'<div class="spell-entry-notes">'+s.notes.replace(/</g,'&lt;').replace(/\\n/g,'<br>')+'</div>':'<em style="color:var(--muted);font-size:13px">No notes</em>')+'<div style="margin-top:12px;text-align:right"><button class="btn" style="background:var(--silver-dim);font-size:10px;padding:6px 14px" onclick="deleteSpell(\\''+s.id+'\\')">Delete</button></div></div></div>';
  }).join('');
}

function renderSpellAnalysis() {
  var el = document.getElementById('spellAnalysisContent');
  var data = getSpells();
  var spells = data.spells;
  if (!spells.length) { el.innerHTML = '<p style="color:var(--muted);padding:16px 0">No data to analyze yet. Log some spells first!</p>'; return; }

  var total = spells.length;
  var concluded = spells.filter(function(s){return s.outcome !== 'pending'});
  var successCount = spells.filter(function(s){return s.outcome === 'success'}).length;
  var successRate = concluded.length ? Math.round(successCount / concluded.length * 100) : 0;

  // By moon phase
  var phaseStats = {};
  spells.forEach(function(s) {
    if (s.outcome === 'pending') return;
    var p = s.moon_phase || 'unknown';
    if (!phaseStats[p]) phaseStats[p] = {total:0,success:0};
    phaseStats[p].total++;
    if (s.outcome === 'success') phaseStats[p].success++;
  });

  // By intention
  var intStats = {};
  spells.forEach(function(s) {
    if (s.outcome === 'pending') return;
    var int = s.intention;
    if (!intStats[int]) intStats[int] = {total:0,success:0};
    intStats[int].total++;
    if (s.outcome === 'success') intStats[int].success++;
  });

  // Most common intentions
  var intCounts = {};
  spells.forEach(function(s) {
    intCounts[s.intention] = (intCounts[s.intention]||0)+1;
  });
  var sortedInts = Object.keys(intCounts).sort(function(a,b){return intCounts[b]-intCounts[a]});

  var html = '<div class="stat-card"><div class="stat-label">Total Spells Cast</div><div class="stat-value">'+total+'</div></div>';
  html += '<div class="stat-card"><div class="stat-label">Overall Success Rate</div><div class="stat-value">'+successRate+'%</div><div class="stat-sub">'+successCount+' of '+concluded.length+' concluded spells</div></div>';

  // Best moon phase
  var phaseEntries = Object.keys(phaseStats).map(function(p){
    var pct = phaseStats[p].total > 0 ? Math.round(phaseStats[p].success / phaseStats[p].total * 100) : 0;
    return {phase:p,pct:pct,total:phaseStats[p].total,success:phaseStats[p].success};
  }).sort(function(a,b){return b.pct - a.pct || b.total - a.total});

  html += '<div class="stat-card"><div class="stat-label">Success by Moon Phase</div>';
  if (phaseEntries.length) {
    phaseEntries.forEach(function(pe) {
      html += '<div class="stat-row"><span class="stat-row-label">'+(MOON_PHASE_LABELS[pe.phase]||pe.phase)+'</span><span>'+pe.pct+'% ('+pe.success+'/'+pe.total+')</span></div>';
    });
  } else {
    html += '<p style="font-size:14px;color:var(--silver-dim)">No concluded spells yet</p>';
  }
  html += '</div>';

  // By intention
  var intEntries = Object.keys(intStats).map(function(int){
    var pct = intStats[int].total > 0 ? Math.round(intStats[int].success / intStats[int].total * 100) : 0;
    return {int:int,pct:pct,total:intStats[int].total,success:intStats[int].success};
  }).sort(function(a,b){return b.pct - a.pct || b.total - a.total});

  html += '<div class="stat-card"><div class="stat-label">Success by Intention</div>';
  if (intEntries.length) {
    intEntries.forEach(function(ie) {
      html += '<div class="stat-row"><span class="stat-row-label">'+ie.int.replace(/_/g,' ')+'</span><span>'+ie.pct+'% ('+ie.success+'/'+ie.total+')</span></div>';
    });
  } else {
    html += '<p style="font-size:14px;color:var(--silver-dim)">No concluded spells yet</p>';
  }
  html += '</div>';

  // Most common intentions
  html += '<div class="stat-card"><div class="stat-label">Most Common Intentions</div>';
  sortedInts.slice(0,5).forEach(function(int) {
    html += '<div class="stat-row"><span class="stat-row-label">'+int.replace(/_/g,' ')+'</span><span>'+intCounts[int]+' spell'+(intCounts[int]>1?'s':'')+'</span></div>';
  });
  html += '</div>';

  el.innerHTML = html;
}

// Init moon phase on load
document.getElementById('spellMoon').value = getMoonPhase(getTodayISO());
</script>

<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '947012561524608');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=947012561524608&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->

</body>
</html>
`;

const SUCCESS_PAGE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Download Ready</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Inter:wght@300;400;500&display=swap');
:root{--cream:#FAF7F2;--gold:#C5A55A;--black:#0A0A0A;--stone:#6B6560;--stone-light:#9B9590}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;font-weight:300;line-height:1.7;color:#1A1A1A;background:var(--cream);display:flex;align-items:center;justify-content:center;min-height:100vh}
.container{max-width:520px;text-align:center;padding:24px}
.divider{width:48px;height:1px;background:var(--gold);margin:0 auto 32px}
h1{font-family:'Cormorant Garamond',serif;font-size:40px;font-weight:600;color:var(--black);margin-bottom:16px}
p{font-size:15px;color:var(--stone);margin-bottom:24px}
.download-btn{display:inline-block;padding:14px 32px;font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;background:var(--black);color:var(--cream);text-decoration:none;border-radius:2px;transition:background .3s}
.download-btn:hover{background:#2D2D2D}
.note{font-size:12px;color:var(--stone-light);margin-top:32px}
.manual-entry{margin-top:24px}
.manual-entry input{padding:10px 16px;font-size:14px;border:1px solid #ddd;border-radius:2px;width:280px;max-width:100%;font-family:'Inter',sans-serif}
.manual-entry button{padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;background:var(--gold);color:var(--black);border:none;border-radius:2px;cursor:pointer;margin-left:8px}
</style></head><body>
<div class="container">
<div class="divider"></div>
<h1>You're in.</h1>
<p>Your app is ready. A copy of your access link has also been sent to your email.</p>
<a id="downloadBtn" href="/app" class="download-btn">Open Coven Compass</a>
<div id="manualEntry" class="manual-entry" style="display:none">
<p>Something went wrong. Enter your purchase email:</p>
<input type="email" id="emailInput" placeholder="you@example.com">
<button onclick="window.location.href='/download?email='+encodeURIComponent(document.getElementById('emailInput').value)">Go</button>
</div>
    <p class="note">Questions? <a href="mailto:support@allmind.biz" style="color:var(--gold)">support@allmind.biz</a></p>
    </div>
    <script>
    if('{{DOWNLOAD_URL}}'==='#'){
      document.getElementById('downloadBtn').style.display='none';
      document.getElementById('manualEntry').style.display='block';
    } else {
      try { localStorage.setItem('cc_unlocked','1'); } catch(e){}
      setTimeout(function(){ window.location.href = '/app'; }, 1500);
    }
    </script>
    <!-- Meta Pixel Code -->
    <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '947012561524608');
    fbq('track', 'PageView');
    fbq('track', 'Purchase', {value: 7.00, currency: 'USD'});
    </script>
    <noscript><img height="1" width="1" style="display:none"
    src="https://www.facebook.com/tr?id=947012561524608&ev=PageView&noscript=1"/></noscript>
    <!-- End Meta Pixel Code -->
    </body></html>`;

// ─── Router ───
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }

    try {
      let response;
      if (path === '/') response = htmlResponse(LANDING_PAGE_HTML);
      else if (path === '/privacy') response = htmlResponse(PRIVACY_HTML);
      else if (path === '/terms') response = htmlResponse(TERMS_HTML);
      else if (request.method === 'GET' && path === '/success') response = await handleSuccess(request, env);
      else if (request.method === 'POST' && path === '/webhook') response = await handleWebhook(request, env);
      else if (request.method === 'GET' && path === '/download') response = await handleDownload(request, env);
      else if (path === '/app') response = htmlResponse(APP_HTML);
      else response = jsonResponse({ error: 'Not found' }, 404);

      return addSecurityHeaders(response);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      return addSecurityHeaders(jsonResponse({ error: 'Internal error' }, 500));
    }
  },
};

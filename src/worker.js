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

  const downloadUrl = `${env.BASE_URL}/download?email=${encodeURIComponent(email)}`;

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
        <a href="${downloadUrl}" style="display:inline-block;padding:14px 32px;background:#0A0A0A;color:#FAF7F2;text-decoration:none;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Download Package</a>
        <p style="color:#9B9590;font-size:13px;margin-top:24px">Or copy this link: ${downloadUrl}</p>
        <hr style="border:none;border-top:1px solid #F0EBE3;margin:32px 0">
        <p style="color:#9B9590;font-size:12px">Unzip and open in any browser. Works offline, forever.<br>Questions? support@allmind.biz</p>
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
  <title>Coven Compass — Every Correspondence, One Place</title>
  <meta name="description" content="Herbs, crystals, candles, days, moon phases, and more — lookup every spell correspondence for any intention instantly.">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500&display=swap');
    :root{--cream:#FAF7F2;--cream-dark:#F0EBE3;--gold:#C5A55A;--gold-light:#D4BA7A;--gold-dark:#A8893E;--black:#0A0A0A;--black-soft:#1A1A1A;--charcoal:#2D2D2D;--stone:#6B6560;--stone-light:#9B9590}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,sans-serif;font-weight:300;line-height:1.7;color:var(--black-soft);background:var(--cream);-webkit-font-smoothing:antialiased}
    .container{max-width:720px;margin:0 auto;padding:0 24px}
    .divider{width:48px;height:1px;background:var(--gold);margin:0 auto}
    .hero{padding:120px 0 80px;text-align:center}
    .hero-label{font-size:11px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:32px}
    .hero h1{font-family:'Cormorant Garamond',serif;font-size:clamp(36px,6vw,64px);font-weight:600;line-height:1.1;color:var(--black);letter-spacing:-.02em;margin-bottom:24px}
    .hero .subhead{font-size:17px;color:var(--stone);max-width:520px;margin:0 auto 48px;font-weight:300}
    .purchase-btn{display:inline-block;padding:16px 32px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;background:var(--black);color:var(--cream);border:none;cursor:pointer;border-radius:2px;text-decoration:none;transition:background .3s}
    .purchase-btn:hover{background:var(--charcoal)}
    .form-note{font-size:12px;color:var(--stone-light);margin-top:16px;text-align:center;letter-spacing:.02em}
    .section-label{font-size:11px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:40px}
    .problem{padding:80px 0}
    .pain-cards{display:grid;gap:1px;background:var(--cream-dark)}
    .pain-card{padding:32px;background:var(--cream)}
    .pain-card p{color:var(--charcoal);font-family:'Cormorant Garamond',serif;font-size:19px;line-height:1.6}
    .solution{padding:80px 0;border-top:1px solid var(--cream-dark)}
    .solution .intro{text-align:center;color:var(--stone);margin-bottom:56px;font-size:15px;max-width:520px;margin-left:auto;margin-right:auto}
    .benefits{display:grid;gap:48px}
    .benefit{display:grid;grid-template-columns:48px 1fr;gap:24px;align-items:start}
    .benefit-marker{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;color:var(--gold);line-height:1;padding-top:2px}
    .benefit h3{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:var(--black);margin-bottom:8px}
    .benefit p{font-size:14px;color:var(--stone)}
    .proof{padding:64px 0;border-top:1px solid var(--cream-dark);border-bottom:1px solid var(--cream-dark)}
    .stats{display:flex;justify-content:center;gap:64px;flex-wrap:wrap}
    .stat{text-align:center}
    .stat-number{font-family:'Cormorant Garamond',serif;font-size:40px;font-weight:700;color:var(--black);line-height:1;margin-bottom:8px}
    .stat-label{font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:var(--stone-light)}
    .faq{padding:80px 0}
    .faq-list{max-width:560px;margin:0 auto}
    .faq-item{padding:24px 0;border-bottom:1px solid var(--cream-dark)}
    .faq-item:first-child{border-top:1px solid var(--cream-dark)}
    .faq-item h3{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:600;color:var(--black);margin-bottom:8px}
    .faq-item p{font-size:14px;color:var(--stone)}
    .cta{padding:100px 0;text-align:center}
    .cta h2{font-family:'Cormorant Garamond',serif;font-size:clamp(28px,4vw,40px);font-weight:600;color:var(--black);margin-bottom:16px}
    .cta p{color:var(--stone);font-size:15px;margin-bottom:40px}
    footer{padding:40px 0;text-align:center;border-top:1px solid var(--cream-dark)}
    footer p{font-size:12px;color:var(--stone-light);letter-spacing:.04em}
    footer a{color:var(--stone-light);text-decoration:none;transition:color .2s}
    footer a:hover{color:var(--gold)}
    footer .legal{margin-top:8px}
    @media(max-width:600px){.hero{padding:80px 0 60px}.purchase-btn{padding:14px 28px;width:100%}.stats{gap:40px}.benefit{grid-template-columns:1fr;gap:8px}.benefit-marker{display:none}}
  </style>
</head>
<body>

  <section class="hero">
    <div class="container">
      <p class="hero-label">Coven Compass</p>
      <h1>Every correspondence for your intention, in one place.</h1>
      <p class="subhead">Type your intention. Get every herb, crystal, candle, day, moon phase, and incense you need. Instantly.</p>
      <div class="divider" style="margin-bottom:48px"></div>
      <a href="https://buy.stripe.com/aFa9AT7s82wa03t3VP8g003" class="purchase-btn">Get Access &mdash; $7</a>
      <p class="form-note">One-time purchase. No subscription.</p>
    </div>
  </section>

  <section class="problem">
    <div class="container">
      <p class="section-label">The Problem</p>
      <div class="pain-cards">
        <div class="pain-card"><p>You spend 30 minutes hunting through blogs, PDFs, and Pinterest boards just to find which herb goes with protection spells.</p></div>
        <div class="pain-card"><p>Subscription apps charge you monthly for reference data that hasn't changed in centuries. Moonly wants $30. Spells8 wants $29/mo. For correspondences.</p></div>
        <div class="pain-card"><p>You have five browser tabs open cross-referencing herbs, crystals, candle colors, days of the week, and moon phases &mdash; and you're still not sure you got it right.</p></div>
      </div>
    </div>
  </section>

  <section class="solution">
    <div class="container">
      <p class="section-label">The Solution</p>
      <p class="intro">Type your intention. Get every correspondence you need. Herbs, crystals, candles, days, moon phases, elements, incense &mdash; all in one place, instantly.</p>
      <div class="benefits">
        <div class="benefit">
          <div class="benefit-marker">I</div>
          <div><h3>Instant Lookup</h3><p>Type an intention and get rosemary, black tourmaline, white candles, Saturday, waning moon, and dragon's blood incense in under two seconds. No tabs. No PDFs.</p></div>
        </div>
        <div class="benefit">
          <div class="benefit-marker">II</div>
          <div><h3>Complete Results</h3><p>Seven categories per intention. Herbs, crystals, candle colors, days, moon phases, elements, and incense. Everything for a full ritual, not just one piece.</p></div>
        </div>
        <div class="benefit">
          <div class="benefit-marker">III</div>
          <div><h3>Works Everywhere</h3><p>Open it on your phone, tablet, or laptop. No app store, no install, no account. Bookmark it and use it whenever you need it.</p></div>
        </div>
      </div>
    </div>
  </section>

  <section class="proof">
    <div class="container">
      <div class="stats">
        <div class="stat"><div class="stat-number">200+</div><div class="stat-label">Herbs and Crystals</div></div>
        <div class="stat"><div class="stat-number">7</div><div class="stat-label">Categories Each</div></div>
        <div class="stat"><div class="stat-number">$0</div><div class="stat-label">Monthly Cost</div></div>
      </div>
    </div>
  </section>

  <section class="faq">
    <div class="container">
      <p class="section-label">Questions</p>
      <div class="faq-list">
        <div class="faq-item"><h3>Does it work offline?</h3><p>Yes. It is a single HTML file with all the data embedded. Once downloaded, it works without internet on any device with a browser.</p></div>
        <div class="faq-item"><h3>Is this for beginners or experienced practitioners?</h3><p>Both. Beginners use it to learn correspondences. Experienced witches use it to save time planning rituals.</p></div>
        <div class="faq-item"><h3>How is this different from free websites?</h3><p>Free sites give you one category at a time across dozens of pages. Coven Compass gives you everything for your intention in one view.</p></div>
      </div>
    </div>
  </section>

  <section class="cta">
    <div class="container">
      <div class="divider" style="margin-bottom:48px"></div>
      <h2>Your next ritual, fully planned in seconds.</h2>
      <p>No subscription. No account. Just the answers you need, forever.</p>
      <a href="https://buy.stripe.com/aFa9AT7s82wa03t3VP8g003" class="purchase-btn">Get Access &mdash; $7</a>
    </div>
  </section>

  <footer>
    <div class="container">
      <img src="/static/logo.png" alt="ALLMIND" style="height:40px;width:auto;margin-bottom:20px;opacity:.7">
      <p>&copy; 2026 Coven Compass. An <a href="https://allmind.ai">ALLMIND</a> venture.</p>
      <p class="legal"><a href="/privacy">Privacy</a> &nbsp;&middot;&nbsp; <a href="/terms">Terms</a></p>
    </div>
  </footer>

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
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Inter:wght@300;400;500&display=swap');
:root{--cream:#FAF7F2;--cream-dark:#F0EBE3;--gold:#C5A55A;--black:#0A0A0A;--charcoal:#2D2D2D;--stone:#6B6560;--stone-light:#9B9590}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;font-weight:300;line-height:1.7;color:var(--charcoal);background:var(--cream);-webkit-font-smoothing:antialiased}
.container{max-width:800px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:'Cormorant Garamond',serif;font-weight:600;color:var(--black)}
.divider{width:48px;height:1px;background:var(--gold);margin:0 auto}

.hero{text-align:center;padding:80px 0 40px}
.hero h1{font-size:clamp(32px,5vw,48px);margin-bottom:12px}
.hero p{font-size:15px;color:var(--stone);max-width:480px;margin:0 auto 32px}

.tabs{display:flex;gap:0;border-bottom:1px solid var(--cream-dark);margin-bottom:40px}
.tab{padding:12px 20px;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--stone-light);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;font-family:'Inter',sans-serif}
.tab:hover{color:var(--stone)}
.tab.active{color:var(--black);border-bottom-color:var(--gold)}

.panel{display:none}.panel.active{display:block}

select{width:100%;padding:14px 20px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--cream-dark);background:white;color:var(--black);border-radius:2px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239B9590' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center}
select:focus{border-color:var(--gold)}

input[type="text"]{width:100%;padding:14px 20px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--cream-dark);background:white;color:var(--black);border-radius:2px;outline:none}
input:focus{border-color:var(--gold)}
input::placeholder{color:var(--stone-light)}

.sheet{margin-top:32px}
.sheet-header{text-align:center;margin-bottom:40px}
.sheet-header h2{font-size:32px;margin-bottom:8px;text-transform:capitalize}
.sheet-header .sub{font-size:12px;color:var(--stone);text-transform:uppercase;letter-spacing:.15em}

.cat-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--cream-dark);margin-bottom:32px}
.cat{padding:24px;background:white}
.cat-label{font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:12px}
.cat-items{font-size:14px;color:var(--charcoal);line-height:1.8}

.supply-group{margin-bottom:2px}
.supply-toggle{font-size:12px;font-weight:500;color:var(--charcoal);padding:10px 16px;background:var(--cream-dark);border:1px solid var(--cream-dark);border-radius:2px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;user-select:none}
.supply-toggle::-webkit-details-marker{display:none}
.supply-toggle::before{content:'▸';font-size:10px;color:var(--gold);transition:transform .2s;display:inline-block}
details[open]>.supply-toggle::before{transform:rotate(90deg)}
details[open]>.supply-toggle{border-bottom:none;border-radius:2px 2px 0 0}
.supply-items{padding:12px 16px;border:1px solid var(--cream-dark);border-top:none;border-radius:0 0 2px 2px;background:white}

.search-result{padding:16px;background:white;border:1px solid var(--cream-dark);margin-bottom:8px;cursor:pointer}
.search-result:hover{border-color:var(--gold)}
.search-result h3{font-size:16px;margin-bottom:4px;text-transform:capitalize}
.search-result p{font-size:12px;color:var(--stone)}

.check-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--cream-dark)}
.check-item input{width:16px;height:16px;accent-color:var(--gold)}
.check-item label{font-size:14px;cursor:pointer;text-transform:capitalize}

.match{padding:16px;background:white;border:1px solid var(--cream-dark);margin-bottom:8px;cursor:pointer}
.match:hover{border-color:var(--gold)}
.match h3{font-size:16px;margin-bottom:4px;text-transform:capitalize}
.match-bar{height:4px;background:var(--cream-dark);margin-top:8px}
.match-fill{height:100%;background:var(--gold)}
.match-score{font-size:11px;color:var(--gold);margin-top:4px}

.btn{display:inline-block;padding:12px 28px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;background:var(--black);color:var(--cream);border:none;cursor:pointer;border-radius:2px}
.btn:hover{background:var(--charcoal)}

@media print{.no-print{display:none!important}body{background:white}.print-area{display:block!important}}
@media(max-width:600px){.cat-grid{grid-template-columns:1fr}}
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
<input type="text" id="revInput" placeholder="Type an herb, crystal, or incense..." oninput="doReverse(this.value)">
<div id="revResults"></div>
</div>

<div id="p-supplies" class="panel">
<p style="color:var(--stone);margin-bottom:16px;font-size:14px">Check what you have on hand.</p>
<div id="supplyChecks"></div>
<div id="supplyResults" style="margin-top:24px"></div>
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

// Tab switching
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
  document.querySelector('[onclick="switchTab(\\'' + name + '\\')"]').classList.add('active');
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
  if (!matches.length) { el.innerHTML = '<p style="color:var(--stone-light);padding:16px 0">No matches.</p>'; return; }
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
    html += '<summary class="supply-toggle">' + label + ' <span style="color:var(--stone-light);font-weight:300;font-size:11px">(' + items.length + ')</span></summary>';
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
  el.innerHTML = '<p style="font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:12px">Best Matches</p>' +
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
</script>

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
<p>Your download is ready. A copy has also been sent to your email.</p>
<a id="downloadBtn" href="{{DOWNLOAD_URL}}" class="download-btn">Download Package</a>
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
  setTimeout(function(){ window.location.href = '{{DOWNLOAD_URL}}'; }, 1500);
}
</script>
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

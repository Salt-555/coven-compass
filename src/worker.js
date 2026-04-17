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
      <a href="https://buy.stripe.com/00wdR98wc0o25nN8c58g002" class="purchase-btn">Get Access &mdash; $7</a>
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
          <div><h3>Own It Forever</h3><p>One download. Works offline in any browser. No subscription, no account, no app store. Open it on your laptop, tablet, or phone whenever you need it.</p></div>
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
      <a href="https://buy.stripe.com/00wdR98wc0o25nN8c58g002" class="purchase-btn">Get Access &mdash; $7</a>
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
      else response = jsonResponse({ error: 'Not found' }, 404);

      return addSecurityHeaders(response);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      return addSecurityHeaders(jsonResponse({ error: 'Internal error' }, 500));
    }
  },
};

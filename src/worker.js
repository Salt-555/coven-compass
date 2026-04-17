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
        <p style="color:#9B9590;font-size:12px">Unzip and open in any browser. Works offline, forever.<br>Questions? support@allmind.ai</p>
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
<p class="note">Questions? <a href="mailto:support@allmind.ai" style="color:var(--gold)">support@allmind.ai</a></p>
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

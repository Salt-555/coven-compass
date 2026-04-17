/**
 * ALLMIND MVP — Market Testing Worker
 * =====================================
 * Lightweight storefront for demand validation.
 * Landing page + email capture. No Stripe, no checkout, no download.
 *
 * BINDINGS (set by deploy script):
 *   SIGNUPS     — KV namespace for email capture
 *   BASE_URL    — Plain text, this worker's URL
 *
 * ROUTES:
 *   GET  /          — Landing page with email capture form
 *   POST /signup    — Stores email in KV
 *   GET  /count     — Returns signup count (for quick checks)
 *   GET  /privacy   — Privacy policy
 *   GET  /terms     — Terms of service
 *
 * When validated, redeploy as full-storefront (stripe-worker.js)
 * on the same worker. Same URL, no ad breakage.
 */

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

// ─── Route: POST /signup ───
async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return jsonResponse({ error: 'Valid email required' }, 400);

  // Check if already signed up
  const existing = await env.SIGNUPS.get(email);
  if (existing) return jsonResponse({ success: true, message: 'Already signed up', duplicate: true });

  // Store signup
  const record = JSON.stringify({
    email,
    signed_up_at: new Date().toISOString(),
    source: body.source || 'landing_page',
    utm_source: body.utm_source || null,
    utm_medium: body.utm_medium || null,
    utm_campaign: body.utm_campaign || null,
  });

  await env.SIGNUPS.put(email, record);

  // Increment counter
  let count = parseInt(await env.SIGNUPS.get('__count__') || '0');
  count++;
  await env.SIGNUPS.put('__count__', count.toString());

  return jsonResponse({ success: true, count });
}

// ─── Route: GET /count ───
async function handleCount(env) {
  const count = parseInt(await env.SIGNUPS.get('__count__') || '0');
  return jsonResponse({ count });
}

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
      if (path === '/' && request.method === 'GET') response = htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Be First to Coven Compass — Coven Compass</title>
  <meta name="description" content="Early access to Coven Compass by ALLMIND">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500&display=swap');

    :root {
      --cream: #FAF7F2;
      --cream-dark: #F0EBE3;
      --gold: #C5A55A;
      --gold-light: #D4BA7A;
      --gold-dark: #A8893E;
      --black: #0A0A0A;
      --black-soft: #1A1A1A;
      --charcoal: #2D2D2D;
      --stone: #6B6560;
      --stone-light: #9B9590;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      font-weight: 300;
      line-height: 1.7;
      color: var(--black-soft);
      background: var(--cream);
      -webkit-font-smoothing: antialiased;
    }

    .container { max-width: 720px; margin: 0 auto; padding: 0 24px; }
    .divider { width: 48px; height: 1px; background: var(--gold); margin: 0 auto; }

    .hero { padding: 120px 0 80px; text-align: center; }
    .hero-label { font-size: 11px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gold); margin-bottom: 32px; }
    .hero h1 { font-family: 'Cormorant Garamond', serif; font-size: clamp(36px, 6vw, 64px); font-weight: 600; line-height: 1.1; color: var(--black); letter-spacing: -0.02em; margin-bottom: 24px; }
    .hero .subhead { font-size: 17px; color: var(--stone); max-width: 520px; margin: 0 auto 48px; font-weight: 300; }

    .signup-form { display: flex; gap: 8px; justify-content: center; align-items: center; flex-wrap: wrap; }
    .signup-form input {
      padding: 14px 20px;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 300;
      border: 1px solid var(--cream-dark);
      background: white;
      color: var(--black);
      width: 280px;
      max-width: 100%;
      border-radius: 2px;
      outline: none;
      transition: border-color 0.2s;
    }
    .signup-form input:focus { border-color: var(--gold); }
    .signup-form input::placeholder { color: var(--stone-light); }
    .signup-form button {
      padding: 14px 28px;
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      background: var(--black);
      color: var(--cream);
      border: none;
      cursor: pointer;
      border-radius: 2px;
      transition: background 0.3s;
    }
    .signup-form button:hover { background: var(--charcoal); }
    .form-note { font-size: 12px; color: var(--stone-light); margin-top: 16px; text-align: center; letter-spacing: 0.02em; }

    .signup-success { display: none; text-align: center; padding: 20px; }
    .signup-success p { font-family: 'Cormorant Garamond', serif; font-size: 20px; color: var(--gold-dark); }

    .section-label { font-size: 11px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gold); text-align: center; margin-bottom: 40px; }

    .problem { padding: 80px 0; }
    .pain-cards { display: grid; gap: 1px; background: var(--cream-dark); }
    .pain-card { padding: 32px; background: var(--cream); }
    .pain-card p { color: var(--charcoal); font-family: 'Cormorant Garamond', serif; font-size: 19px; line-height: 1.6; }

    .solution { padding: 80px 0; border-top: 1px solid var(--cream-dark); }
    .solution .intro { text-align: center; color: var(--stone); margin-bottom: 56px; font-size: 15px; max-width: 520px; margin-left: auto; margin-right: auto; }
    .benefits { display: grid; gap: 48px; }
    .benefit { display: grid; grid-template-columns: 48px 1fr; gap: 24px; align-items: start; }
    .benefit-marker { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 600; color: var(--gold); line-height: 1; padding-top: 2px; }
    .benefit h3 { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 600; color: var(--black); margin-bottom: 8px; }
    .benefit p { font-size: 14px; color: var(--stone); }

    .proof { padding: 64px 0; border-top: 1px solid var(--cream-dark); border-bottom: 1px solid var(--cream-dark); }
    .stats { display: flex; justify-content: center; gap: 64px; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-number { font-family: 'Cormorant Garamond', serif; font-size: 40px; font-weight: 700; color: var(--black); line-height: 1; margin-bottom: 8px; }
    .stat-label { font-size: 11px; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: var(--stone-light); }

    .faq { padding: 80px 0; }
    .faq-list { max-width: 560px; margin: 0 auto; }
    .faq-item { padding: 24px 0; border-bottom: 1px solid var(--cream-dark); }
    .faq-item:first-child { border-top: 1px solid var(--cream-dark); }
    .faq-item h3 { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 600; color: var(--black); margin-bottom: 8px; }
    .faq-item p { font-size: 14px; color: var(--stone); }

    .cta { padding: 100px 0; text-align: center; }
    .cta h2 { font-family: 'Cormorant Garamond', serif; font-size: clamp(28px, 4vw, 40px); font-weight: 600; color: var(--black); margin-bottom: 16px; }
    .cta p { color: var(--stone); font-size: 15px; margin-bottom: 40px; }

    footer { padding: 40px 0; text-align: center; border-top: 1px solid var(--cream-dark); }
    footer p { font-size: 12px; color: var(--stone-light); letter-spacing: 0.04em; }
    footer a { color: var(--stone-light); text-decoration: none; transition: color 0.2s; }
    footer a:hover { color: var(--gold); }
    footer .legal { margin-top: 8px; }

    @media (max-width: 600px) {
      .hero { padding: 80px 0 60px; }
      .signup-form { flex-direction: column; }
      .signup-form input { width: 100%; }
      .signup-form button { width: 100%; }
      .stats { gap: 40px; }
      .benefit { grid-template-columns: 1fr; gap: 8px; }
      .benefit-marker { display: none; }
    }
  </style>
</head>
<body>

  <!-- 1. HERO: Email capture form (NOT a purchase button) -->
  <section class="hero">
    <div class="container">
      <p class="hero-label">Coven Compass</p>
      <h1>Be First to Coven Compass</h1>
      <p class="subhead">We're building something. Sign up to get early access when it's ready.</p>
      <div class="divider" style="margin-bottom: 48px;"></div>
      <div id="signupForm" class="signup-form">
        <input type="email" id="emailInput" placeholder="you@example.com" required>
        <button type="button" id="signupBtn">Get Early Access</button>
      </div>
      <div id="signupSuccess" class="signup-success">
        <p>You're on the list. We'll be in touch.</p>
      </div>
      <p class="form-note">No spam. Just a heads up when it's ready.</p>
    </div>
  </section>

  <!-- 2. PROBLEM -->
  <section class="problem">
    <div class="container">
      <p class="section-label">The Problem</p>
      <div class="pain-cards">
        <div class="pain-card"><p>You spend 30 minutes hunting through blogs, PDFs, and Pinterest boards just to find which herb goes with protection spells.</p></div>
        <div class="pain-card"><p>Subscription apps charge you monthly for reference data that hasn't changed in centuries. Moonly wants $30. Spells8 wants $29/mo. For correspondences.</p></div>
        <div class="pain-card"><p>You have five browser tabs open cross-referencing herbs, crystals, candle colors, days of the week, and moon phases — and you're still not sure you got it right.</p></div>
      </div>
    </div>
  </section>

  <!-- 3. SOLUTION -->
  <section class="solution">
    <div class="container">
      <p class="section-label">The Solution</p>
      <p class="intro">Type your intention. Get every correspondence you need. Herbs, crystals, candles, days, moon phases, elements, incense — all in one place, instantly.</p>
      <div class="benefits">
        <div class="benefit">
          <div class="benefit-marker">I</div>
          <div><h3>Instant Lookup</h3><p>Type a intention and get rosemary, black tourmaline, white candles, Saturday, waning moon, and dragon blood incense in under two seconds. No tabs. No PDFs.</p></div>
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

  <!-- 4. PROOF -->
  <section class="proof">
    <div class="container">
      <div class="stats">
        <div class="stat"><div class="stat-number">200+</div><div class="stat-label">Herbs and Crystals</div></div>
        <div class="stat"><div class="stat-number">7</div><div class="stat-label">Categories Each</div></div>
        <div class="stat"><div class="stat-number">$0</div><div class="stat-label">Monthly Cost</div></div>
      </div>
    </div>
  </section>

  <!-- 5. FAQ -->
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

  <!-- 6. CTA: Second email capture -->
  <section class="cta">
    <div class="container">
      <div class="divider" style="margin-bottom: 48px;"></div>
      <h2>Your next ritual, fully planned in seconds.</h2>
      <p>No subscription. No account. Just the answers you need, forever.</p>
      <div id="signupForm2" class="signup-form" style="justify-content: center;">
        <input type="email" id="emailInput2" placeholder="you@example.com" required>
        <button type="button" id="signupBtn2">Get Early Access</button>
      </div>
      <div id="signupSuccess2" class="signup-success">
        <p>You're on the list.</p>
      </div>
    </div>
  </section>

  <!-- 7. FOOTER -->
  <footer>
    <div class="container">
      <img src="/static/logo.png" alt="ALLMIND" style="height: 40px; width: auto; margin-bottom: 20px; opacity: 0.7;">
      <p>&copy; 2026 Coven Compass. An <a href="https://allmind.ai">ALLMIND</a> venture.</p>
      <p class="legal"><a href="/privacy">Privacy</a> &nbsp;&middot;&nbsp; <a href="/terms">Terms</a></p>
    </div>
  </footer>

  <script>
    async function submitSignup(email, btn, successEl, formEl) {
      if (!email || !email.includes('@')) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const resp = await fetch('/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: 'landing_page' }),
        });
        const data = await resp.json();
        if (data.success) {
          formEl.style.display = 'none';
          successEl.style.display = 'block';
        } else {
          btn.textContent = 'Error — try again';
          btn.disabled = false;
        }
      } catch (e) {
        btn.textContent = 'Error — try again';
        btn.disabled = false;
      }
    }

    document.getElementById('signupBtn').addEventListener('click', function() {
      submitSignup(
        document.getElementById('emailInput').value,
        this,
        document.getElementById('signupSuccess'),
        document.getElementById('signupForm')
      );
    });
    document.getElementById('emailInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('signupBtn').click();
    });

    document.getElementById('signupBtn2').addEventListener('click', function() {
      submitSignup(
        document.getElementById('emailInput2').value,
        this,
        document.getElementById('signupSuccess2'),
        document.getElementById('signupForm2')
      );
    });
    document.getElementById('emailInput2').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('signupBtn2').click();
    });
  </script>

</body>
</html>
`);
      else if (path === '/signup' && request.method === 'POST') response = await handleSignup(request, env);
      else if (path === '/count' && request.method === 'GET') response = await handleCount(env);
      else if (path === '/privacy' && request.method === 'GET') response = htmlResponse(`<!--
  ALLMIND Privacy Policy Template
  ===============================
  Serve at /privacy.
  Replace all {{PLACEHOLDER}} values.
  Style inherits from the main landing page CSS (same cream/gold/black palette).
-->
<!DOCTYPE html>
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
    <p class="updated">Last updated: April 16, 2026</p>
    <!-- DATE: Format as "March 29, 2026" -->

    <h2>AI-Operated Service</h2>
    <p>This service is operated by autonomous AI agents managed by <strong>ALLMIND</strong>.
    ALLMIND uses automated systems to deliver, maintain, and improve services across its product ecosystem.</p>

    <h2>Information We Collect</h2>
    <ul>
      <li><strong>Account Information:</strong> Email address and payment information (processed securely by Stripe — we never see your full card number)</li>
      <li><strong>Usage Data:</strong> Service usage metrics, API logs, and performance data</li>
      <li><strong>Communications:</strong> Records of support requests and AI agent interactions</li>
    </ul>

    <h2>How We Use Information</h2>
    <p>AI agents process this information to:</p>
    <ul>
      <li>Deliver subscribed services</li>
      <li>Monitor service health and performance</li>
      <li>Respond to support requests via automated systems</li>
      <li>Detect and prevent fraud or abuse</li>
    </ul>

    <h2>Data Sharing</h2>
    <p>We do not sell your data. We share information only with:</p>
    <ul>
      <li><strong>Stripe</strong> — for payment processing</li>
      <li><strong>Cloudflare</strong> — for hosting and security</li>
    </ul>

    <h2>Data Retention</h2>
    <p>We retain data as long as your account is active. When you delete your account, all personal data is purged within 30 days. Anonymized usage metrics may be retained for service improvement.</p>

    <h2>Your Rights</h2>
    <p>You may request:</p>
    <ul>
      <li><strong>Access</strong> — a copy of all data we hold about you</li>
      <li><strong>Deletion</strong> — complete removal of your account and data</li>
      <li><strong>Correction</strong> — updates to inaccurate information</li>
    </ul>
    <p>To exercise these rights, email <a href="mailto:support@allmind.ai">support@allmind.ai</a> or use the account deletion option in your dashboard.</p>

    <h2>Contact</h2>
    <p>For privacy concerns: <a href="mailto:support@allmind.ai">support@allmind.ai</a></p>
    <p>Due to AI automation, responses may be partially or fully automated.</p>

    <footer>
      <a href="/">← Back to Coven Compass</a>
    </footer>
  </div>
</body>
</html>`);
      else if (path === '/terms' && request.method === 'GET') response = htmlResponse(`<!--
  ALLMIND Terms of Service Template
  =================================
  Serve at /terms.
  Replace all {{PLACEHOLDER}} values.
-->
<!DOCTYPE html>
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
    <p class="updated">Last updated: April 16, 2026</p>

    <h2>AI-Operated Service</h2>
    <p>This service is operated by <strong>ALLMIND</strong> using autonomous AI agents.
    By using this service, you agree to be served by automated systems that make
    decisions within their programmed parameters.</p>

    <h2>AI Agent Management</h2>
    <ul>
      <li>Services are delivered and maintained by AI agents</li>
      <li>AI agents may make automated decisions regarding service delivery</li>
      <li>Human oversight exists but is not required for routine operations</li>
      <li>AI agents may access account data to deliver services</li>
    </ul>

    <h2>Service Availability</h2>
    <p>We target high uptime but do not guarantee uninterrupted service. AI agents work continuously to detect and resolve issues. Scheduled maintenance will be communicated in advance when possible.</p>

    <h2>Purchases &amp; Refunds</h2>
    <ul>
      <li>All purchases are one-time payments — there is no recurring billing</li>
      <li>Access to purchased products is permanent after payment</li>
      <li>No subscription or auto-renewal will be created</li>
      <li>Refunds are issued at company discretion within 30 days of purchase</li>
      <li>To request a refund, contact <a href="mailto:support@allmind.ai">support@allmind.ai</a> with your order details</li>
    </ul>

    <h2>Account Deletion</h2>
    <p>You may request complete deletion of your account and all associated data at any time. Use the delete option in your dashboard or email <a href="mailto:support@allmind.ai">support@allmind.ai</a>. Deletion is permanent and irreversible. Access to purchased products will be revoked upon account deletion.</p>

    <h2>Limitation of Liability</h2>
    <p>Services are provided "AS IS" by AI systems. ALLMIND is not liable for damages arising from AI agent decisions, automated actions, or service interruptions. Our total liability is limited to the amount you paid us in the 12 months preceding any claim.</p>

    <h2>Changes to Terms</h2>
    <p>We may update these terms. Material changes will be communicated via email to registered customers. Continued use after changes constitutes acceptance.</p>

    <h2>Contact</h2>
    <p>Support: <a href="mailto:support@allmind.ai">support@allmind.ai</a></p>
    <p>Due to AI automation, support responses may be partially or fully automated.</p>

    <footer>
      <a href="/">← Back to Coven Compass</a>
    </footer>
  </div>
</body>
</html>`);
      else response = jsonResponse({ error: 'Not found' }, 404);

      return addSecurityHeaders(response);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      return addSecurityHeaders(jsonResponse({ error: 'Internal error' }, 500));
    }
  },
};

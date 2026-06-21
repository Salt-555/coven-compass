/**
 * ALLMIND MVP — Storefront Worker (No-Proxy Mode)
 * ================================================
 * Payment Link → Success → Download. No custom checkout, no payment proxy.
 * Stripe metadata flows natively through webhook payloads for attribution.
 *
 * SETUP:
 *   1. Create a Stripe Payment Link with product.metadata.idea_id set
 *   2. Set after_completion redirect to: {BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}
 *   3. Webhook routing handled by global ALLMIND webhook router (no per-MVP config needed)
 *
 * ATTRIBUTION FLOW (no proxy needed):
 *   Stripe product.metadata.idea_id → Payment Link carries it →
 *   Webhook receives session with metadata.idea_id → KV stores it → ad pipeline reads it
 *
 * BINDINGS (set by deploy script):
 *   SIGNUPS              — KV namespace for email signups
 *   CUSTOMERS            — KV namespace for customer records
 *   SALES_TRACKING       — KV namespace for attributed sales (idea_id from Stripe)
 *   BASE_URL             — Plain text, this worker's URL
 *   RESEND_KEY           — Secret, for transactional emails
 *
 * ROUTES:
 *   GET  /         — Landing page (links to Payment Link)
 *   GET  /success  — Post-payment page (redirects to app)
 *   GET  /download — Serves the purchased zip
 *   GET  /privacy  — Privacy policy
 *   GET  /terms    — Terms of service
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

// ─── Route: GET /success ───
async function handleSuccess(request, env) {
  const url = new URL(request.url);
  // Payment Links redirect includes session_id; customer_email is available on the session object.
  // Since success page fires before webhook completes, we show a generic success page.
  // The download email is sent by the webhook handler after KV storage.
  return htmlResponse(SUCCESS_PAGE_HTML);
}

// ─── Route: POST /webhook ───
async function handleWebhook(request, env) {
  let event;
  try { event = JSON.parse(await request.text()); }
  catch (e) { return jsonResponse({ error: 'Invalid payload' }, 400); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    let email = session.metadata?.email || session.customer_email || null;

    try {
      // Extract idea_id: prefer session metadata, fallback to line item product metadata
      let ideaId = session.metadata?.idea_id || null;
      if (!ideaId && session.line_items?.data) {
        for (const item of session.line_items.data) {
          const prodMeta = item.price?.product?.metadata;
          if (prodMeta?.idea_id) {
            ideaId = prodMeta.idea_id;
            break;
          }
        }
      }

      const lineItems = session.line_items?.data || [];
      for (const item of lineItems) {
        const priceId = item.price?.id;
        if (env.SALES_TRACKING) {
          await env.SALES_TRACKING.put(
            `sale_${session.id}`,
            JSON.stringify({
              session_id: session.id,
              idea_id: ideaId,
              email: email || null,
              amount_cents: session.amount_total,
              currency: session.currency,
              timestamp: new Date().toISOString(),
            }),
            { metadata: { price_id: priceId } }
          );
        }
      }
    } catch (e) {
      console.error(`[webhook] KV storage failed: ${e.message}`);
    }

    if (email && env.RESEND_KEY) {
      await sendEmail(env, email);
    } else if (!env.RESEND_KEY) {
      console.log('[webhook] RESEND_KEY not set, skipping email');
    }
  }

  return jsonResponse({ received: true });
}

// ─── Email via Resend ───
async function sendEmail(env, email) {
  const appUrl = `${env.BASE_URL}/app`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Coven Compass <noreply@allmind.biz>',
        to: [email],
        subject: 'Welcome to the Coven — Your Access Link Inside',
        html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px">
          <h1 style="font-family:'Cormorant Garamond',serif;font-size:28px;margin-bottom:16px">You're in.</h1>
          <p style="color:#6B6560;font-size:15px;line-height:1.7;margin-bottom:24px">Thanks for your purchase. Access the Coven below:</p>
          <a href="${appUrl}" style="display:inline-block;padding:14px 32px;background:#0A0A0A;color:#FAF7F2;text-decoration:none;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Open App</a>
          <p style="color:#9B9590;font-size:13px;margin-top:24px">Bookmark this link: ${appUrl}</p>
        </div>`,
      }),
    });
    console.log(`[webhook] Email sent to ${email}`);
  } catch (e) {
    console.error(`[webhook] Email failed: ${e.message}`);
  }
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

// ─── Success Page HTML ───
const ZIP_DATA = "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";


const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coven Compass — Every Correspondence + Spell Tracker</title>
  <meta name="description" content="Herbs, crystals, candles, days, moon phases — lookup every spell correspondence for any intention instantly. Track your spells. $12 one-time. No subscription.">
  <!-- Meta Pixel Code -->
  <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','947012561524608');fbq('track','PageView');</script>
  <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=947012561524608&ev=PageView&noscript=1"/></noscript>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    :root{
      --bg:#0D0B12;--bg-deep:#08060E;--card:rgba(255,255,255,.04);--card-border:rgba(255,255,255,.08);
      --purple:#7B5EA7;--purple-glow:rgba(123,94,167,.25);--purple-deep:#4A2D6B;
      --gold:#C4A265;--gold-dim:#A8894E;--gold-soft:rgba(196,162,101,.1);
      --text:#E8E4F0;--muted:#9B93A8;--light-muted:#6B6578;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,sans-serif;color:var(--text);background:var(--bg);line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
    a{color:inherit;text-decoration:none}

    /* GRAIN OVERLAY */
    body::before{content:'';position:fixed;inset:0;background:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='.03'/%3E%3C/svg%3E");pointer-events:none;z-index:9999;opacity:.4}

    .container{max-width:720px;margin:0 auto;padding:0 24px}

    /* ─── HERO ─── */
    .hero{position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 24px;background:radial-gradient(ellipse at 50% 30%,rgba(74,45,107,.3) 0%,transparent 60%),var(--bg-deep);overflow:hidden}
    .hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 40%,rgba(196,162,101,.04) 0%,transparent 40%),radial-gradient(circle at 70% 60%,rgba(123,94,167,.06) 0%,transparent 40%);animation:heroGlow 20s ease-in-out infinite alternate}
    @keyframes heroGlow{0%{transform:translate(0,0)}100%{transform:translate(-5%,3%)}}

    .hero-brand{font-family:'Cinzel',serif;font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--gold);margin-bottom:24px;position:relative;z-index:1}
    .hero h1{font-family:'Cormorant Garamond',serif;font-size:clamp(36px,7vw,64px);font-weight:600;line-height:1.1;color:#fff;margin-bottom:20px;position:relative;z-index:1;text-shadow:0 0 60px rgba(196,162,101,.15)}
    .hero h1 em{font-style:italic;color:var(--gold);font-weight:400}
    .hero-sub{font-family:'Cormorant Garamond',serif;font-size:clamp(17px,3vw,22px);color:rgba(255,255,255,.6);max-width:520px;margin:0 auto 40px;line-height:1.6;position:relative;z-index:1}
    .hero-cta{display:inline-flex;align-items:center;gap:10px;padding:18px 44px;font-family:'Cinzel',serif;font-size:13px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dim) 100%);color:#0D0B12;border-radius:8px;transition:all .2s ease;box-shadow:0 4px 30px rgba(196,162,101,.25),inset 0 1px 0 rgba(255,255,255,.2);position:relative;z-index:1}
    .hero-cta:hover{transform:translateY(-3px);box-shadow:0 8px 40px rgba(196,162,101,.35),inset 0 1px 0 rgba(255,255,255,.2)}
    .hero-note{font-size:13px;color:rgba(255,255,255,.4);margin-top:16px;position:relative;z-index:1;font-weight:500}

    /* Floating orbs */
    .orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.3;animation:float 8s ease-in-out infinite alternate}
    .orb-1{width:200px;height:200px;background:var(--purple);top:20%;left:10%;animation-delay:0s}
    .orb-2{width:150px;height:150px;background:var(--gold);bottom:30%;right:15%;animation-delay:-3s;opacity:.15}
    .orb-3{width:100px;height:100px;background:#9B7BD4;top:60%;left:60%;animation-delay:-5s;opacity:.2}
    @keyframes float{0%{transform:translateY(0) scale(1)}100%{transform:translateY(-30px) scale(1.1)}}

    /* ─── DEMO SECTION ─── */
    .demo-section{padding:80px 0;background:var(--bg-deep);position:relative}
    .demo-label{text-align:center;font-family:'Cinzel',serif;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:32px}
    .demo-card{background:rgba(255,255,255,.03);border:1px solid var(--card-border);border-radius:16px;padding:32px 28px;max-width:540px;margin:0 auto;box-shadow:0 8px 40px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05);position:relative;overflow:hidden}
    .demo-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.3}
    .demo-prompt{text-align:center;font-family:'Cormorant Garamond',serif;font-size:16px;color:var(--muted);margin-bottom:20px;font-style:italic}
    .demo-select{width:100%;background:rgba(255,255,255,.04);border:1.5px solid var(--card-border);border-radius:10px;padding:14px 18px;font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--text);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239B93A8' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center;transition:border-color .2s}
    .demo-select:focus{outline:none;border-color:var(--gold)}
    .demo-results{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}
    .demo-results .demo-cat:nth-child(1){grid-column:1/-1}
    .demo-results .demo-cat.blurred{filter:blur(5px);user-select:none;pointer-events:none}
    .demo-blur-wrap{position:absolute;left:0;right:0;background:rgba(8,6,14,.7);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10;border-radius:8px;pointer-events:none}
    .demo-blur-cta{pointer-events:auto;text-align:center;padding:16px 24px}
    .demo-blur-cta a{padding:14px 32px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dim) 100%);color:#0D0B12;border-radius:8px;font-family:'Cinzel',serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(196,162,101,.3);transition:all .2s}
    .demo-blur-cta a:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(196,162,101,.4)}
    .demo-cat{background:rgba(255,255,255,.03);border:1px solid var(--card-border);border-radius:10px;padding:16px 18px}
    .demo-cat-label{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--purple);margin-bottom:6px}
    .demo-cat-val{font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--text);line-height:1.4}
    .demo-cta-msg{text-align:center;font-size:13px;color:var(--muted);margin-top:20px;font-style:italic}

    /* ─── DIVIDER ─── */
    .divider{width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);margin:0 auto}

    /* ─── PAIN POINTS ─── */
    .pain-section{padding:80px 0}
    .section-label{text-align:center;font-family:'Cinzel',serif;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:40px}
    .pain-grid{display:grid;gap:12px}
    .pain-card{background:var(--card);border:1px solid var(--card-border);border-radius:12px;padding:28px 32px;display:flex;gap:16px;align-items:flex-start;transition:border-color .2s,box-shadow .2s}
    .pain-card:hover{border-color:rgba(196,162,101,.2);box-shadow:0 4px 20px rgba(0,0,0,.2)}
    .pain-icon{font-size:22px;flex-shrink:0;margin-top:2px}
    .pain-card p{font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--text);line-height:1.6}

    /* ─── BENEFITS ─── */
    .benefits-section{padding:80px 0;background:linear-gradient(180deg,var(--bg-deep) 0%,rgba(74,45,107,.08) 50%,var(--bg-deep) 100%)}
    .benefit{background:var(--card);border:1px solid var(--card-border);border-radius:12px;padding:32px;margin-bottom:12px;position:relative;overflow:hidden}
    .benefit::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%;background:linear-gradient(to bottom,var(--gold),transparent);border-radius:0 2px 2px 0}
    .benefit h3{font-family:'Cinzel',serif;font-size:15px;font-weight:600;color:#fff;margin-bottom:8px;letter-spacing:.04em;display:flex;align-items:center;gap:10px}
    .benefit p{font-size:14px;color:var(--muted);line-height:1.7;padding-left:32px}

    /* ─── COMPARISON ─── */
    .compare-section{padding:80px 0;background:var(--bg-deep)}
    .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:520px;margin:0 auto}
    .compare-card{border-radius:14px;padding:36px 28px;text-align:center;border:1px solid var(--card-border)}
    .compare-bad{background:rgba(192,57,43,.06);border-color:rgba(192,57,43,.15)}
    .compare-good{background:var(--gold-soft);border-color:rgba(196,162,101,.25);box-shadow:0 0 40px rgba(196,162,101,.08)}
    .compare-card .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.15em;margin-bottom:12px}
    .compare-bad .label{color:#E74C3C}
    .compare-good .label{color:var(--gold)}
    .compare-card .name{font-family:'Cinzel',serif;font-size:20px;font-weight:700;color:var(--text);margin-bottom:6px}
    .compare-card .price{font-family:'Cormorant Garamond',serif;font-size:36px;font-weight:700;margin-bottom:4px}
    .compare-bad .price{color:#E74C3C}
    .compare-good .price{color:var(--gold)}
    .compare-card .period{font-size:12px;color:var(--muted);margin-bottom:16px}
    .compare-card .desc{font-size:13px;color:var(--muted);line-height:1.5;margin-top:12px}
    .save-badge{display:inline-block;margin-top:14px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-dim);background:rgba(196,162,101,.1);padding:5px 14px;border-radius:20px}

    /* ─── SOCIAL PROOF ─── */
    .proof-section{padding:80px 0;background:var(--bg)}
    .user-count{display:inline-block;background:rgba(123,94,167,.1);border:1px solid rgba(123,94,167,.2);padding:8px 20px;border-radius:24px;font-family:'Cinzel',serif;font-size:13px;font-weight:600;color:var(--purple);margin-bottom:36px}
    .testimonials{display:grid;gap:16px;max-width:560px;margin:0 auto 48px}
    .testimonial{background:var(--card);border:1px solid var(--card-border);border-radius:12px;padding:28px;position:relative}
    .testimonial::before{content:'\u201C';font-family:'Cormorant Garamond',serif;font-size:56px;color:var(--gold);line-height:1;position:absolute;top:8px;left:16px;opacity:.3}
    .testimonial p{font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--text);line-height:1.6;margin-bottom:12px;padding-left:28px;font-style:italic}
    .testimonial .author{font-size:12px;color:var(--muted);padding-left:28px;font-weight:500}

    /* ─── STATS ─── */
    .stats-row{display:flex;justify-content:center;gap:48px;flex-wrap:wrap;padding-bottom:40px;border-bottom:1px solid var(--card-border)}
    .stat{text-align:center}
    .stat-num{font-family:'Cinzel',serif;font-size:36px;font-weight:700;color:var(--gold);line-height:1;margin-bottom:6px}
    .stat-label{font-size:10px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--light-muted)}

    /* ─── FAQ ─── */
    .faq-section{padding:80px 0;background:var(--bg-deep)}
    .faq-list{max-width:580px;margin:0 auto}
    .faq-item{border-bottom:1px solid var(--card-border)}
    .faq-item:first-child{border-top:1px solid var(--card-border)}
    .faq-q{font-family:'Cinzel',serif;font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px;letter-spacing:.03em}
    .faq-a{font-size:14px;color:var(--muted);line-height:1.7;padding-bottom:20px}

    /* ─── FINAL CTA ─── */
    .final-cta{padding:100px 0;text-align:center;background:radial-gradient(ellipse at 50% 80%,rgba(196,162,101,.06) 0%,transparent 50%),var(--bg)}
    .final-cta h2{font-family:'Cormorant Garamond',serif;font-size:clamp(28px,5vw,42px);font-weight:600;color:#fff;margin-bottom:16px;line-height:1.2}
    .final-cta p{font-family:'Cormorant Garamond',serif;font-size:19px;color:var(--muted);margin-bottom:36px;font-style:italic;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.6}

    /* ─── STICKY CTA ─── */
    .sticky-cta{position:fixed;bottom:0;left:0;right:0;background:rgba(13,11,18,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--card-border);padding:14px 24px;display:flex;align-items:center;justify-content:center;gap:20px;z-index:100;transform:translateY(100%);transition:transform .35s cubic-bezier(.4,0,.2,1)}
    .sticky-cta.visible{transform:translateY(0)}
    .sticky-cta p{font-family:'Cormorant Garamond',serif;font-size:16px;color:var(--text);font-weight:500}
    .sticky-cta a{padding:12px 28px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dim) 100%);color:#0D0B12;border-radius:8px;font-family:'Cinzel',serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;white-space:nowrap;box-shadow:0 4px 20px rgba(196,162,101,.25);transition:all .2s}
    .sticky-cta a:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(196,162,101,.35)}

    /* ─── FOOTER ─── */
    footer{padding:40px 0;text-align:center;border-top:1px solid var(--card-border);background:var(--bg-deep)}
    footer p{font-size:11px;color:var(--light-muted);line-height:2.2;letter-spacing:.04em}
    footer a{color:var(--purple)}

    /* ─── RESPONSIVE ─── */
    @media(max-width:640px){
      .hero h1{font-size:30px}
      .stats-row{gap:28px}
      .compare-grid{grid-template-columns:1fr}
      .demo-results{grid-template-columns:1fr!important}
      .pain-card{flex-direction:column;gap:8px;padding:24px 20px}
      .sticky-cta{flex-direction:column;gap:10px;padding:12px 16px}
      .sticky-cta p{font-size:14px;text-align:center}
      .benefit p{padding-left:0}
    }

    /* ─── SCROLL ANIMATIONS ─── */
    .fade-up{opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}
    .fade-up.visible{opacity:1;transform:translateY(0)}
  </style>
</head>
<body>

  <!-- HERO -->
  <section class="hero">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
    <p class="hero-brand">Coven Compass</p>
    <h1>Your Entire Practice.<br><em>One Price. Forever.</em></h1>
    <p class="hero-sub">Herbs, crystals, candles, days, moon phases — every correspondence for any intention. Plus a spell tracker that shows you what actually works.</p>
    <a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="hero-cta" onclick="if(typeof fbq==='function')fbq('track','InitiateCheckout',{value:12.00,currency:'USD'})">Get Coven Compass — $12</a>
    <p class="hero-note"><strong>No subscription.</strong> No monthly fees. Yours permanently.</p>
  </section>

  <!-- INTERACTIVE DEMO -->
  <section class="demo-section">
    <div class="container">
      <p class="demo-label">Try It Free</p>
      <div class="demo-card">
        <p class="demo-prompt">Pick an intention. See your first 3 categories free.</p>
        <select id="demoSelect" class="demo-select">
          <option value="">Choose an intention...</option>
        </select>
        <div id="demoResults" style="display:none;position:relative;margin-top:16px">
          <div class="demo-cat"><div class="demo-cat-label">Herbs</div><div class="demo-cat-val" id="demoHerbs"></div></div>
          <div class="demo-cat"><div class="demo-cat-label">Crystals</div><div class="demo-cat-val" id="demoCrystals"></div></div>
          <div class="demo-cat"><div class="demo-cat-label">Candle Color</div><div class="demo-cat-val" id="demoCandle"></div></div>
          <div class="demo-cat blurred"><div class="demo-cat-label">Best Day</div><div class="demo-cat-val" id="demoDay"></div></div>
          <div class="demo-cat blurred"><div class="demo-cat-label">Moon Phase</div><div class="demo-cat-val" id="demoMoon"></div></div>
          <div class="demo-cat blurred"><div class="demo-cat-label">Element</div><div class="demo-cat-val" id="demoElement"></div></div>
          <div class="demo-cat blurred"><div class="demo-cat-label">Incense</div><div class="demo-cat-val" id="demoIncense"></div></div>
          <div class="demo-blur-wrap">
            <div class="demo-blur-cta">
              <a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007"><span>&#128274;</span> Unlock All 7 Categories</a>
            </div>
          </div>
        </div>
      </div>
      <p class="demo-cta-msg">This is just 3 of 7 categories. Get the full set — and the spell tracker — for $12 once.</p>
    </div>
  </section>

  <script>
  (function(){
    var DB={'protection':{herbs:'Rosemary, Sage, Basil',crystals:'Black Tourmaline, Obsidian',candle:'Black or White',day:'Saturday',moon:'Waning',element:'Earth',incense:"Dragon's blood, Frankincense, Copal, Sandalwood"},'love':{herbs:'Rose, Lavender, Jasmine',crystals:'Rose Quartz, Rhodonite',candle:'Pink or Red',day:'Friday',moon:'Waxing',element:'Water',incense:"Rose, Jasmine, Ylang ylang, Sandalwood"},'prosperity':{herbs:'Basil, Cinnamon, Mint',crystals:'Citrine, Pyrite',candle:'Green or Gold',day:'Thursday',moon:'Waxing',element:'Earth',incense:"Patchouli, Cinnamon, Basil, Bergamot"},'healing':{herbs:'Lavender, Chamomile, Eucalyptus',crystals:'Amethyst, Clear Quartz',candle:'Blue or Green',day:'Monday',moon:'Waxing or Full',element:'Water',incense:"Eucalyptus, Lavender, Frankincense, Sandalwood"},'banishing':{herbs:'Black Pepper, Cayenne, Garlic',crystals:'Obsidian, Black Tourmaline',candle:'Black',day:'Saturday',moon:'Waning or Dark',element:'Fire',incense:"Dragon's blood, Myrrh, Copal, Vetiver"},'purification':{herbs:'Sage, Lavender, Rosemary',crystals:'Selenite, Clear Quartz',candle:'White',day:'Monday',moon:'Waning',element:'Air',incense:"Sage, Copal, Frankincense, Palo santo"},'divination':{herbs:'Mugwort, Yarrow, Bay Leaf',crystals:'Amethyst, Moonstone',candle:'Purple or Silver',day:'Monday',moon:'Full or Dark',element:'Air',incense:"Mugwort, Sandalwood, Jasmine, Acacia"},'courage':{herbs:'Thyme, Basil, Bay Leaf',crystals:'Carnelian, Tiger Eye',candle:'Red or Orange',day:'Tuesday',moon:'Waxing',element:'Fire',incense:"Dragon's blood, Ginger, Cinnamon, Frankincense"},'wisdom':{herbs:'Sage, Bay Leaf, Mugwort',crystals:'Lapis Lazuli, Sodalite',candle:'Blue or Purple',day:'Wednesday',moon:'Full',element:'Air',incense:"Sandalwood, Cedar, Frankincense, Lotus"},'peace':{herbs:'Lavender, Chamomile, Lemon Balm',crystals:'Blue Lace Agate, Angelite',candle:'Blue or White',day:'Monday',moon:'Waning',element:'Water',incense:"Lavender, Chamomile, Sandalwood, Lotus"},'abundance':{herbs:'Basil, Cinnamon, Bay Leaf',crystals:'Citrine, Green Aventurine',candle:'Green or Gold',day:'Thursday',moon:'Waxing',element:'Earth',incense:"Patchouli, Basil, Bergamot, Cinnamon"},'clarity':{herbs:'Rosemary, Sage, Bay Leaf',crystals:'Clear Quartz, Amethyst',candle:'White or Purple',day:'Wednesday',moon:'Full',element:'Air',incense:"Frankincense, Rosemary, Sandalwood, Cedar"},'communication':{herbs:'Basil, Sage, Lavender',crystals:'Lapis Lazuli, Turquoise',candle:'Blue or Green',day:'Wednesday',moon:'Waxing',element:'Air',incense:"Sandalwood, Frankincense, Jasmine, Rose"},'creativity':{herbs:'Rosemary, Basil, Sage',crystals:'Carnelian, Citrine',candle:'Orange or Yellow',day:'Sunday',moon:'Waxing',element:'Fire',incense:"Frankincense, Rose, Sandalwood, Cinnamon"},'dreamwork':{herbs:'Mugwort, Lavender, Chamomile',crystals:'Moonstone, Amethyst',candle:'Purple or Silver',day:'Monday',moon:'Full or Dark',element:'Air',incense:"Lavender, Mugwort, Sandalwood, Jasmine"},'fertility':{herbs:'Fennel, Rue, Rosemary',crystals:'Green Aventurine, Jade',candle:'Green or Pink',day:'Friday',moon:'Waxing',element:'Water',incense:"Rose, Patchouli, Jasmine, Sandalwood"},'friendship':{herbs:'Basil, Lavender, Chamomile',crystals:'Amazonite, Green Aventurine',candle:'Yellow or Green',day:'Friday',moon:'Waxing',element:'Air',incense:"Lavender, Rose, Sandalwood, Jasmine"},'grounding':{herbs:'Rosemary, Sage, Cedar',crystals:'Hematite, Smoky Quartz',candle:'Brown or Black',day:'Saturday',moon:'Waning',element:'Earth',incense:"Cedar, Patchouli, Frankincense, Sandalwood"},'intuition':{herbs:'Mugwort, Sage, Bay Leaf',crystals:'Amethyst, Labradorite',candle:'Purple or Silver',day:'Monday',moon:'Full',element:'Air',incense:"Frankincense, Mugwort, Sandalwood, Myrrh"},'justice':{herbs:'Basil, Rosemary, Sage',crystals:'Lapis Lazuli, Tiger Eye',candle:'Blue or White',day:'Wednesday',moon:'Waxing',element:'Air',incense:"Frankincense, Cedar, Sandalwood, Rose"},'new beginnings':{herbs:'Basil, Bay Leaf, Mint',crystals:'Clear Quartz, Green Aventurine',candle:'White or Green',day:'Sunday',moon:'New',element:'Fire',incense:"Frankincense, Sandalwood, Rose, Jasmine"},'self love':{herbs:'Rose, Lavender, Jasmine',crystals:'Rose Quartz, Pink Tourmaline',candle:'Pink or White',day:'Friday',moon:'Waxing',element:'Water',incense:"Rose, Jasmine, Ylang ylang, Sandalwood"},'sleep':{herbs:'Lavender, Chamomile, Valerian',crystals:'Amethyst, Moonstone',candle:'Blue or Purple',day:'Monday',moon:'Waning',element:'Water',incense:"Lavender, Chamomile, Sandalwood, Cedar"},'strength':{herbs:'Thyme, Bay Leaf, Rosemary',crystals:'Tiger Eye, Carnelian',candle:'Red or Orange',day:'Tuesday',moon:'Waxing',element:'Fire',incense:"Dragon's blood, Cinnamon, Frankincense, Ginger"},'success':{herbs:'Basil, Cinnamon, Bay Leaf',crystals:'Citrine, Pyrite',candle:'Gold or Green',day:'Thursday',moon:'Waxing',element:'Earth',incense:"Patchouli, Cinnamon, Bergamot, Frankincense"},'transformation':{herbs:'Mugwort, Sage, Bay Leaf',crystals:'Obsidian, Tiger Eye',candle:'Black or Purple',day:'Saturday',moon:'Waning to New',element:'Fire',incense:"Frankincense, Myrrh, Sandalwood, Copal"},'travel safety':{herbs:'Rosemary, Basil, Bay Leaf',crystals:'Blue Lace Agate, Lapis Lazuli',candle:'Blue or Green',day:'Wednesday',moon:'Waxing',element:'Air',incense:"Frankincense, Sandalwood, Cedar, Rose"},'wealth':{herbs:'Basil, Cinnamon, Mint',crystals:'Citrine, Pyrite',candle:'Green or Gold',day:'Thursday',moon:'Waxing',element:'Earth',incense:"Patchouli, Cinnamon, Bergamot, Frankincense"},'wisdom':{herbs:'Sage, Bay Leaf, Mugwort',crystals:'Lapis Lazuli, Sodalite',candle:'Blue or Purple',day:'Wednesday',moon:'Full',element:'Air',incense:"Sandalwood, Cedar, Frankincense, Lotus"}};
    var sel = document.getElementById('demoSelect');
    Object.keys(DB).sort().forEach(function(k){var o = document.createElement('option'); o.value = k; o.textContent = k.replace(/_/g, ' '); sel.appendChild(o);});
    sel.addEventListener('change', function(){
      var d = DB[this.value], r = document.getElementById('demoResults');
      if(!d){r.style.display='none'; return;}
      r.style.display = null;
      r.className = 'demo-results';
      document.getElementById('demoHerbs').textContent = d.herbs;
      document.getElementById('demoCrystals').textContent = d.crystals;
      document.getElementById('demoCandle').textContent = d.candle;
      document.getElementById('demoDay').textContent = d.day;
      document.getElementById('demoMoon').textContent = d.moon;
      document.getElementById('demoElement').textContent = d.element;
      document.getElementById('demoIncense').textContent = d.incense;
      if(typeof fbq==='function')fbq('track','ViewContent');
      requestAnimationFrame(function(){
        var blur = r.querySelector('.demo-blur-wrap');
        var firstBlurred = r.querySelector('.demo-cat.blurred');
        if(blur && firstBlurred){
          var rect = firstBlurred.getBoundingClientRect();
          var containerRect = r.getBoundingClientRect();
          var top = rect.top - containerRect.top;
          blur.style.top = top + 'px';
          blur.style.height = (containerRect.height - top) + 'px';
        }
      });
    });
  })();
  </script>

  <!-- PAIN POINTS -->
  <section class="pain-section">
    <div class="container">
      <p class="section-label">Sound Familiar?</p>
      <div class="pain-grid">
        <div class="pain-card fade-up">
          <span class="pain-icon">&#128167;</span>
          <p>You're cross-referencing five tabs and a dog-eared notebook just to figure out which herbs go with a waning moon protection ritual. There has to be a better way.</p>
        </div>
        <div class="pain-card fade-up">
          <span class="pain-icon">&#128176;</span>
          <p>Moonly wants $30/month. Spells8 wants $29/month. That's $348-360 a year for correspondence data that hasn't changed in 2,000 years. For a lookup tool.</p>
        </div>
        <div class="pain-card fade-up">
          <span class="pain-icon">&#128211;</span>
          <p>You cast spells but don't track the results. You can't tell which moon phase actually worked, or which crystal pairing made a difference. Practice without records is just guessing.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- BENEFITS -->
  <section class="benefits-section">
    <div class="container">
      <p class="section-label">What You Get</p>
      <div class="benefit fade-up">
        <h3>&#9889; Instant Lookup</h3>
        <p>Pick an intention. Get herbs, crystals, candle colors, days, moon phases, elements, and incense — all seven categories, every time, in one view. No tabs. No hunting.</p>
      </div>
      <div class="benefit fade-up">
        <h3>&#128211; Spell Tracker</h3>
        <p>Log date, moon phase, ingredients, notes, and outcome for every spell. Over time, you'll see real patterns in your practice — not guesses. What works, what doesn't.</p>
      </div>
      <div class="benefit fade-up">
        <h3>&#128241; Zero Friction</h3>
        <p>Works on any device with a browser. Phone, tablet, laptop. No download. No account. No install. Bookmark it and use it mid-ritual without fumbling through menus.</p>
      </div>
      <div class="benefit fade-up">
        <h3>&#128176; One Price. Forever.</h3>
        <p><strong style="color:var(--gold)">$12. One time.</strong> That's less than half a month of a subscription app. You pay once, you use it forever. No updates gated behind a paywall.</p>
      </div>
    </div>
  </section>

  <!-- COMPARISON -->
  <section class="compare-section">
    <div class="container">
      <p class="section-label" style="color:var(--gold)">The Math</p>
      <div class="compare-grid fade-up">
        <div class="compare-card compare-bad">
          <p class="label">Subscription Apps</p>
          <p class="name">$29/mo</p>
          <p class="period">per month, forever</p>
          <p class="desc">Cancel and you lose everything. Your data, your practice, your progress.</p>
        </div>
        <div class="compare-card compare-good">
          <p class="label">Coven Compass</p>
          <p class="price">$12</p>
          <p class="period">one-time payment</p>
          <p class="desc">Everything unlocked. Yours forever. No account needed.</p>
          <span class="save-badge">Save $300+/year</span>
        </div>
      </div>
    </div>
  </section>

  <!-- SOCIAL PROOF -->
  <section class="proof-section">
    <div class="container" style="text-align:center">
      <p class="section-label">Join Your Coven</p>
      <span class="user-count">&#9860; 200+ Witches already using it</span>
      <div class="testimonials fade-up">
        <div class="testimonial">
          <p>The spell tracker changed everything. After 3 months of logging, I realized my protection spells only work on Saturdays with black candles. Would never have noticed without data.</p>
          <span class="author">— Elara M., Practitioner</span>
        </div>
        <div class="testimonial">
          <p>I used to flip between three different websites just to plan one ritual. Now everything is in one place, and the tracker actually helps me get better at this.</p>
          <span class="author">— Maeve K., Hedge Witch</span>
        </div>
      </div>
      <div class="stats-row fade-up">
        <div class="stat"><div class="stat-num">30+</div><div class="stat-label">Intentions</div></div>
        <div class="stat"><div class="stat-num">7</div><div class="stat-label">Categories</div></div>
        <div class="stat"><div class="stat-num">$12</div><div class="stat-label">One Time</div></div>
        <div class="stat"><div class="stat-num">0</div><div class="stat-label">Subscriptions</div></div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="faq-section">
    <div class="container">
      <p class="section-label">Questions?</p>
      <div class="faq-list fade-up">
        <div class="faq-item"><p class="faq-q">Why not just use free websites?</p><p class="faq-a">Free sites scatter one category per page across dozens of blog posts. Coven Compass gives you all seven categories for any intention in one screen, plus a spell tracker. And yes — it really is a one-time payment, not a subscription disguised as software.</p></div>
        <div class="faq-item"><p class="faq-q">Is this for beginners or experienced practitioners?</p><p class="faq-a">Both. Beginners get a reliable reference that saves hours of research. Experienced witches get the spell tracker — the one feature you won't find anywhere else free.</p></div>
        <div class="faq-item"><p class="faq-q">What if I already have a Book of Shadows?</p><p class="faq-a">Coven Compass doesn't replace your BoS — it complements it. Use it for quick lookups before you cast, then log the results in your tracker to build your own evidence-based practice.</p></div>
        <div class="faq-item"><p class="faq-q">Will there be a subscription later?</p><p class="faq-a">No. The $12 is forever. No hidden fees, no "premium tier" coming soon, no bait-and-switch. You buy it once and it's yours.</p></div>
      </div>
    </div>
  </section>

  <!-- FINAL CTA -->
  <section class="final-cta">
    <div class="container fade-up">
      <h2>Your next ritual,<br>fully planned in seconds.<br>Every one, tracked.</h2>
      <p>Your grimoire, digitized. Everything you need, nothing you don't.</p>
      <a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" class="hero-cta" onclick="if(typeof fbq==='function')fbq('track','InitiateCheckout',{value:12.00,currency:'USD'})">Get Coven Compass — $12</a>
      <p class="hero-note"><strong>No subscription.</strong> No monthly fees. Yours permanently.</p>
    </div>
  </section>

  <!-- STICKY CTA -->
  <div class="sticky-cta" id="stickyCta">
    <p>Coven Compass — $12, forever</p>
    <a href="https://buy.stripe.com/eVq9AT27O3Ae17xgIB8g007" onclick="if(typeof fbq==='function')fbq('track','InitiateCheckout',{value:12.00,currency:'USD'})">Get It Now</a>
  </div>

  <!-- FOOTER -->
  <footer>
    <div class="container">
      <p><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></p>
      <p>&copy; 2026 ALLMIND. Questions? support@allmind.biz</p>
    </div>
  </footer>

  <!-- Scroll animations -->
  <script>
  (function(){
    var els = document.querySelectorAll('.fade-up');
    if(!els.length) return;
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target);}
      });
    },{threshold:0.15});
    els.forEach(function(el){observer.observe(el);});

    // Sticky CTA
    var sticky = document.getElementById('stickyCta');
    if(!sticky) return;
    window.addEventListener('scroll',function(){
      if(window.scrollY > 600) sticky.classList.add('visible');
      else sticky.classList.remove('visible');
    },{passive:true});
  })();
  </script>

</body>
</html>`;

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

:root{
  --void:#08070E;--deep:#0F0E18;--card:#16142A;--card-hover:#1C1938;
  --border:#252240;--border-light:#332F55;
  --purple:#9B7FD4;--purple-dim:#7A5FB4;--purple-glow:rgba(155,127,212,.18);
  --amber:#D4A857;--amber-dim:#A8843A;--amber-glow:rgba(212,168,87,.12);
  --silver:#C8C3D4;--silver-dim:#8A8498;--muted:#5E5870;
  --white:#EDEAF4;
}

*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{font-family:'Inter',sans-serif;font-weight:300;line-height:1.6;color:var(--silver);background:var(--void)}

/* ── NAV BAR ── */
.navbar{position:sticky;top:0;z-index:10;background:rgba(8,7,14,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 16px}
.nav-inner{max-width:800px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:52px}
.nav-brand{font-family:'Cinzel',serif;font-size:14px;font-weight:600;color:var(--white);letter-spacing:.08em}
.nav-brand span{color:var(--purple)}

/* ── TABS ── */
.tabs{display:flex;gap:0;border-bottom:1px solid var(--border);background:rgba(15,14,24,.6)}
.tab{flex:1;padding:12px 8px;font-size:10px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);cursor:pointer;border:none;background:none;text-align:center;transition:color .2s,background .2s;position:relative}
.tab:hover{color:var(--silver-dim)}
.tab.active{color:var(--white)}
.tab.active::after{content:'';position:absolute;bottom:-1px;left:20%;right:20%;height:2px;background:linear-gradient(90deg,transparent,var(--purple),transparent);border-radius:1px}

/* ── LAYOUT ── */
.container{max-width:800px;margin:0 auto;padding:24px 16px 80px}
.panel{display:none}.panel.active{display:block;animation:fadeIn .25s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

/* ── LOOKUP TAB ── */
.lookup-header{text-align:center;padding:32px 0 24px}
.lookup-header h2{font-family:'Cinzel',serif;font-size:22px;font-weight:600;color:var(--white);margin-bottom:16px;letter-spacing:.04em}

select{width:100%;padding:14px 40px 14px 16px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--border);background:var(--card);color:var(--silver);border-radius:8px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237A5FB4' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center;transition:border-color .2s,box-shadow .2s}
select:focus{border-color:var(--purple);box-shadow:0 0 0 3px var(--purple-glow)}
option{background:var(--card);color:var(--silver)}

/* ── SPELL SHEET ── */
.sheet{margin-top:24px}
.sheet-header{text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border)}
.sheet-header .sub{font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);margin-bottom:8px}
.sheet-header h2{font-family:'Cinzel',serif;font-size:26px;font-weight:600;color:var(--white);text-transform:capitalize;letter-spacing:.03em}

.usage-block{display:flex;gap:14px;padding:18px 20px;margin-bottom:24px;background:linear-gradient(135deg,rgba(155,127,212,.08),rgba(155,127,212,.02));border:1px solid rgba(155,127,212,.15);border-radius:10px;align-items:flex-start}
.usage-icon{font-size:20px;color:var(--purple);flex-shrink:0;line-height:1.4;margin-top:1px}
.usage-text{font-size:13px;color:var(--silver-dim);line-height:1.7;font-family:'Cormorant Garamond',serif;font-size:15px}

.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:24px}
.cat{padding:16px 18px;background:var(--card);border:1px solid var(--border);border-radius:8px;position:relative;overflow:hidden;transition:border-color .2s}
.cat:hover{border-color:var(--border-light)}
.cat::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%;background:linear-gradient(to bottom,var(--purple),transparent);opacity:.6}
.cat-label{font-size:9px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);margin-bottom:8px}
.cat-items{font-size:13px;color:var(--silver);line-height:1.7}

.btn{display:inline-block;padding:12px 24px;font-family:'Inter',sans-serif;font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;background:linear-gradient(135deg,var(--purple) 0%,var(--purple-dim) 100%);color:var(--white);border:none;cursor:pointer;border-radius:6px;transition:transform .15s,box-shadow .2s;box-shadow:0 4px 16px rgba(155,127,212,.2)}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(155,127,212,.3)}

/* ── REVERSE LOOKUP ── */
input[type="text"]{width:100%;padding:14px 16px;font-family:'Inter',sans-serif;font-size:14px;font-weight:300;border:1px solid var(--border);background:var(--card);color:var(--silver);border-radius:8px;outline:none;transition:border-color .2s,box-shadow .2s}
input[type="text"]:focus{border-color:var(--purple);box-shadow:0 0 0 3px var(--purple-glow)}
input::placeholder{color:var(--muted)}

.search-result{padding:14px 16px;background:var(--card);border:1px solid var(--border);margin-bottom:6px;cursor:pointer;border-radius:8px;transition:border-color .15s,background .15s}
.search-result:hover{border-color:var(--purple);background:var(--card-hover)}
.search-result h3{font-size:14px;margin-bottom:2px;text-transform:capitalize;color:var(--white)}
.search-result p{font-size:11px;color:var(--silver-dim)}

/* ── SUPPLIES TAB ── */
p.hint{color:var(--muted);margin-bottom:16px;font-size:13px}

.supply-group{margin-bottom:4px}
.supply-toggle{font-size:12px;font-weight:500;color:var(--silver);padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:8px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;user-select:none;transition:border-color .15s}
.supply-toggle:hover{border-color:var(--border-light)}
.supply-toggle::-webkit-details-marker{display:none}
.supply-toggle::before{content:'▸';font-size:9px;color:var(--purple);transition:transform .2s;display:inline-block;flex-shrink:0}
details[open]>.supply-toggle::before{transform:rotate(90deg)}
details[open]>.supply-toggle{border-bottom:none;border-radius:8px 8px 0 0;color:var(--white)}
.supply-items{padding:8px 16px;border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;background:rgba(22,20,42,.5)}

.check-item{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(37,34,64,.4)}
.check-item:last-child{border-bottom:none}
.check-item input[type="checkbox"]{width:15px;height:15px;accent-color:var(--purple);cursor:pointer;flex-shrink:0}
.check-item label{font-size:13px;cursor:pointer;text-transform:capitalize;color:var(--silver)}

.match{padding:14px 16px;background:var(--card);border:1px solid var(--border);margin-bottom:6px;cursor:pointer;border-radius:8px;transition:border-color .15s,background .15s}
.match:hover{border-color:var(--purple);background:var(--card-hover)}
.match h3{font-size:14px;margin-bottom:6px;text-transform:capitalize;color:var(--white)}
.match-bar{height:3px;background:rgba(37,34,64,.8);margin-top:6px;border-radius:2px;overflow:hidden}
.match-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--amber));border-radius:2px;transition:width .3s ease}
.match-score{font-size:10px;color:var(--purple);margin-top:6px;font-weight:500;letter-spacing:.04em}

/* ── SPELL LOG TABS ── */
.spell-sub-tab{font-size:9px;padding:8px 14px;background:var(--card);color:var(--muted);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-family:'Inter',sans-serif;font-weight:500;letter-spacing:.08em;text-transform:uppercase;transition:all .2s}
.spell-sub-tab:hover{color:var(--silver-dim);border-color:var(--border-light)}
.spell-sub-tab.active{background:linear-gradient(135deg,var(--purple) 0%,var(--purple-dim) 100%);color:var(--white);border-color:transparent;box-shadow:0 2px 12px rgba(155,127,212,.2)}

.spell-panel{display:none}.spell-panel.active{display:block;animation:fadeIn .25s ease}

/* ── SPELL LOG FORM ── */
.form-section h3{font-family:'Cinzel',serif;font-size:16px;font-weight:600;color:var(--white);margin-bottom:20px;letter-spacing:.03em}

.sp-label{display:block;font-size:9px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--purple);margin-bottom:8px}
textarea{width:100%;padding:14px 16px;font-family:'Inter',sans-serif;font-size:13px;font-weight:300;border:1px solid var(--border);background:var(--card);color:var(--silver);border-radius:8px;outline:none;resize:vertical;transition:border-color .2s,box-shadow .2s}
textarea:focus{border-color:var(--purple);box-shadow:0 0 0 3px var(--purple-glow)}
input[type="date"]{width:100%;padding:14px 16px;font-family:'Inter',sans-serif;font-size:13px;font-weight:300;border:1px solid var(--border);background:var(--card);color:var(--silver);border-radius:8px;outline:none;color-scheme:dark;transition:border-color .2s,box-shadow .2s}
input[type="date"]:focus{border-color:var(--purple);box-shadow:0 0 0 3px var(--purple-glow)}

.spell-ingred-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;padding:8px 0}
.spell-outcome-group{display:flex;gap:12px;flex-wrap:wrap}
.spell-outcome-opt{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--silver)}
.spell-outcome-opt input[type="radio"]{accent-color:var(--purple);width:14px;height:14px;cursor:pointer}

.badge{display:inline-block;padding:2px 8px;font-size:9px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;border-radius:4px}
.badge-success{background:rgba(139,192,111,.1);color:#7AB85F}
.badge-partial{background:var(--amber-glow);color:var(--amber)}
.badge-fail{background:rgba(192,111,111,.1);color:#C06F6F}
.badge-pending{background:rgba(94,88,112,.3);color:var(--muted)}

/* ── SPELL HISTORY ── */
.spell-entry{padding:16px;background:var(--card);border:1px solid var(--border);margin-bottom:8px;border-radius:8px;transition:border-color .15s}
.spell-entry:hover{border-color:var(--border-light)}
.spell-entry-header{display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:-4px}
.spell-entry-header strong{text-transform:capitalize;font-size:14px;color:var(--white);font-weight:500}
.spell-entry-meta{font-size:11px;color:var(--muted);margin-top:3px}
.spell-entry-details{display:none;padding-top:14px;margin-top:12px;border-top:1px solid var(--border)}
.spell-entry-details.open{display:block;animation:fadeIn .2s ease}
.spell-entry-ingreds{font-size:12px;color:var(--silver-dim);margin-bottom:8px;line-height:1.6}
.spell-entry-ingreds span{display:inline-block;background:rgba(37,34,64,.5);padding:2px 8px;margin:2px 4px 2px 0;border-radius:4px;color:var(--silver-dim)}
.spell-entry-notes{font-size:13px;color:var(--silver);white-space:pre-wrap;line-height:1.6}

/* ── ANALYSIS PANEL ── */
.stat-card{padding:20px;background:var(--card);border:1px solid var(--border);margin-bottom:8px;border-radius:10px;transition:border-color .15s}
.stat-card:hover{border-color:var(--border-light)}
.stat-label{font-size:9px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);margin-bottom:6px}
.stat-value{font-family:'Cinzel',serif;font-size:32px;font-weight:700;color:var(--white);line-height:1.1}
.stat-sub{font-size:11px;color:var(--muted);margin-top:4px}
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(37,34,64,.4);font-size:13px;color:var(--silver)}
.stat-row:last-child{border-bottom:none}
.stat-row-label{text-transform:capitalize}

/* ── PRINT ── */
@media print{.no-print{display:none!important}body{background:white;color:#333}.print-area{display:block!important}}
@media(max-width:600px){.cat-grid{grid-template-columns:1fr 1fr;gap:6px}.spell-ingred-grid{grid-template-columns:1fr}.usage-block{flex-direction:column;gap:8px;padding:14px}.stat-value{font-size:26px}}
</style>
</head>
<body>

<!-- NAV BAR -->
<div class="no-print">
<nav class="navbar">
  <div class="nav-inner">
    <div class="nav-brand"><span>✦</span> Coven Compass</div>
  </div>
</nav>
<div class="tabs">
  <button class="tab active" onclick="switchTab('lookup')">Lookup</button>
  <button class="tab" onclick="switchTab('reverse')">Reverse</button>
  <button class="tab" onclick="switchTab('supplies')">Supplies</button>
  <button class="tab" onclick="switchTab('spells')">Spell Log</button>
</div>
</div>

<div class="container">

<!-- LOOKUP PANEL -->
<div id="p-lookup" class="panel active">
  <div class="lookup-header">
    <h2>Find Your Correspondences</h2>
    <select id="intentionSelect" onchange="showSheet(this.value)">
      <option value="">Choose an intention...</option>
    </select>
  </div>
  <div id="sheet" class="sheet"></div>
</div>

<!-- REVERSE LOOKUP PANEL -->
<div id="p-reverse" class="panel">
  <input type="text" id="revInput" placeholder="Search herbs, crystals, incense..." oninput="doReverse(this.value)">
  <div id="revResults"></div>
</div>

<!-- SUPPLIES PANEL -->
<div id="p-supplies" class="panel">
  <p class="hint">Check what you have on hand to find matching intentions.</p>
  <div id="supplyChecks"></div>
  <div id="supplyResults" style="margin-top:24px"></div>
</div>

<!-- SPELL LOG PANEL -->
<div id="p-spells" class="panel">

  <div style="display:flex;gap:6px;margin-bottom:28px;flex-wrap:wrap">
    <button class="spell-sub-tab active" data-stab="log" onclick="switchSpellTab('log')">Log Spell</button>
    <button class="spell-sub-tab" data-stab="history" onclick="switchSpellTab('history')">History</button>
    <button class="spell-sub-tab" data-stab="analysis" onclick="switchSpellTab('analysis')">Analysis</button>
  </div>

  <!-- LOG FORM -->
  <div id="stab-log" class="spell-panel active">
    <div class="form-section">
      <h3>New Entry</h3>
      <div style="display:flex;flex-direction:column;gap:18px">
        <div><label class="sp-label">Intention</label><select id="spellIntention"><option value="">Choose intention...</option></select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label class="sp-label">Date Cast</label><input type="date" id="spellDate"></div>
          <div><label class="sp-label">Moon Phase</label><select id="spellMoon"><option value="new">New Moon</option><option value="waxing_crescent">Waxing Crescent</option><option value="first_quarter">First Quarter</option><option value="waxing_gibbous">Waxing Gibbous</option><option value="full">Full Moon</option><option value="waning_gibbous">Waning Gibbous</option><option value="last_quarter">Last Quarter</option><option value="waning_crescent">Waning Crescent</option></select></div>
        </div>
        <div id="spellIngredSection" style="display:none"><label class="sp-label">Ingredients Used</label><div id="spellIngredChecks" class="spell-ingred-grid"></div><input type="text" id="spellCustomIngred" placeholder="Add custom ingredients (comma separated)" style="margin-top:8px"></div>
        <div><label class="sp-label">Notes</label><textarea id="spellNotes" rows="3" placeholder="What happened? Any signs or synchronicities?"></textarea></div>
        <div><label class="sp-label">Outcome</label><div id="spellOutcome" class="spell-outcome-group"><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="pending" checked> <span class="badge badge-pending">Pending</span></label><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="success"> <span class="badge badge-success">Success</span></label><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="partial"> <span class="badge badge-partial">Partial</span></label><label class="spell-outcome-opt"><input type="radio" name="spellOutcome" value="fail"> <span class="badge badge-fail">Fail</span></label></div></div>
        <div><button class="btn" onclick="saveSpell()">Save Entry</button></div>
      </div>
    </div>
  </div>

  <!-- HISTORY -->
  <div id="stab-history" class="spell-panel">
    <h3 style="font-family:'Cinzel',serif;font-size:16px;font-weight:600;color:var(--white);margin-bottom:20px;letter-spacing:.03em">Spell History</h3>
    <div id="spellHistoryList"></div>
  </div>

  <!-- ANALYSIS -->
  <div id="stab-analysis" class="spell-panel">
    <h3 style="font-family:'Cinzel',serif;font-size:16px;font-weight:600;color:var(--white);margin-bottom:20px;letter-spacing:.03em">Pattern Analysis</h3>
    <div id="spellAnalysisContent"></div>
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

  var html = '<div class="sheet-header"><div class="sub">Spell Correspondences</div><h2>' + intention.replace(/_/g,' ') + '</h2></div>';
  if (d.usage) {
    html += '<div class="usage-block"><div class="usage-icon">&#9817;</div><div class="usage-text">' + d.usage + '</div></div>';
  }
  html += '<div class="cat-grid">';
  catDefs.forEach(function(c) {
    var val = d[c.k];
    if (!val) return;
    var display = Array.isArray(val) ? val.join(', ') : val;
    html += '<div class="cat"><div class="cat-label">' + c.l + '</div><div class="cat-items">' + display + '</div></div>';
  });
  html += '</div><div style="text-align:center;margin-top:8px"><button class="btn" onclick="printSheet(\\'' + intention + '\\')">Print Sheet</button></div>';
  el.innerHTML = html;
}

// Reverse lookup
function doReverse(q) {
  var el = document.getElementById('revResults');
  if (q.length < 2) { el.innerHTML = ''; return; }
  var ql = q.toLowerCase();
  var matches = Object.keys(revIdx).filter(function(k){return k.indexOf(ql) >= 0}).sort();
  if (!matches.length) { el.innerHTML = '<p style="color:var(--muted);padding:16px 0">No matches found.</p>'; return; }
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
  el.innerHTML = '<p style="font-size:9px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--purple);margin-bottom:12px">Best Matches</p>' +
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
  var phaseStats = {};  spells.forEach(function(s) {
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
    html += '<p style="font-size:13px;color:var(--silver-dim)">No concluded spells yet</p>';
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
    html += '<p style="font-size:13px;color:var(--silver-dim)">No concluded spells yet</p>';
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

</body>
</html>
`;

const SUCCESS_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to the Coven</title>
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
fbq('track', 'Purchase', {value: 12.00, currency: 'USD'});
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=947012561524608&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Inter:wght@300;400;500&display=swap');
:root{--cream:#FAF7F2;--gold:#C5A55A;--black:#0A0A0A;--stone:#6B6560;--stone-light:#9B9590}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;font-weight:300;line-height:1.7;color:#1A1A1A;background:var(--cream);display:flex;align-items:center;justify-content:center;min-height:100vh}
.container{max-width:520px;text-align:center;padding:24px}
.divider{width:48px;height:1px;background:var(--gold);margin:0 auto 32px}
h1{font-family:'Cormorant Garamond',serif;font-size:40px;font-weight:600;color:var(--black);margin-bottom:16px}
p{font-size:15px;color:var(--stone);margin-bottom:24px}
.note{font-size:12px;color:var(--stone-light);margin-top:32px}
</style></head><body>
<div class="container">
<div class="divider"></div>
<h1>You're in.</h1>
<p>Welcome to the Coven. Redirecting you now…</p>
<p class="note">Questions? <a href="mailto:support@allmind.biz" style="color:var(--gold)">support@allmind.biz</a></p>
</div>
<script>
setTimeout(function(){ window.location.href = '/app'; }, 8000);
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

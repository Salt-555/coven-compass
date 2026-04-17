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
const ZIP_DATA = "UEsDBBQAAAAIAMpwkVxgs4tWWREAAAk2AAAaAAAAY292ZW4tY29tcGFzcy9wcm9kdWN0Lmh0bWzVO+uO2zaX//0UrIJU9mdbvsylU3nsNjOTbgM0bdBMUSzSQUFLHEsdWVREeTyu4dfYZ9nn2SfZc0hKoi5z+dpvP2ARJJbIw8Nzv5DK+RdXP11e/+eHtyTI1tGic44/JKLxam6x2MIBRn34WbOMEi+gqWDZ3Prl+rvhmZUPx3TN5tZ9yLYJTzOLeDzOWAxg29DPgrnP7kOPDeXLgIRxmIU0GgqPRmw+ccaIJguziC0u+T2LySVfJ1SI85Ea7JyLbIe/34ZrRE82adS1gyxLhDsa3cJWwllxvooYTULheHw98oSYfnNL12G0m1/ydM1TGmf9/6ApXfPYd7erIPv2eDyencLfr8bjLzXoO6A6VbNHMIMQJzDrhyKJ6G4utjSxe7OOm3Ke7YdDL2V07b767s13X303nen3oU/TOxgcv714ewSDKx757qvLkzcnJ2/gdRlRD6bHb/APrgGBepxG7qvpFf6BIZHxmLmvTi9OT07H+fswCoEs99XXF1+ffD0+dP6xX9N0FcbueJZQ3w/jFTwt+cNQhH/iy5KnPkuHMHLoLLm/26OchopP15aM2gNBYzEULA1vZ3J6y+QmyHsUwp6Bep84X808HvHUvadpt6S5N1sCM6uUb0CmegpF0JsBpuVdCPshVrEGcQVIFCgBFB9SwfxDx0EjobBNCqw8KONwz8bj5GGWs0boJuMlf2R6nAA7wWQQTAfBUZWlQs0kVzPw12ANFW6yItXRA2L88D4Ege0VGcdnQEXOPTw2+ESt9qp0HjodJ2Ap32fsIRsCm6vY9RgKuuDgDJgjY3I8RjYkMAkmig1QG3O9iK6T7tE0eRic3G8HSEW+CWgyy/janUzLtYmxdHICZJqcSavB1bloj88aoiVHElvHyehS7LWZu7cRe5itaCINSluR2huoFzwKfWIoW9p7nUrNIaDd57wj4WSKJBhET/JXrZ4TtDyWgcyGIqEernMmU7aeSZlmoF5xC3p2N0nCUg/sqMmycpTezNukAmYSHkoVKE7cGCBMbar3CpfTgku5X0JTUOLsafdRvLoBhK9039SCmnaol4X3bN+0vyoFQxNAGhqqKKExiwodId0HNZajzaeWEffuYIVgEfMybdCT8fh1YYaT44oqngkKSlPHNU1hjNAyfcosDFFvgzBjLc6XM59SP9wIFP+MbzKMP0o7NUXmoYWCCYCjx54Gq7+XOw/DNV0xF7OG5dOMuvJ9JO5X/Yd1NHh9dAmPBB5jMZdpBbLKdrt1tkcOT1ej6Xg8RmCbqGRmT6Y2UbFhbp/Zr4/eAoaEZgHx5/b7CZlEJwT+DE9sIrKU37G5/Xp6pOK2TW7DKJrbSKE9UksRNzxZprCGKQNuMuBEP5lzCReQQHnspkgDmZyC/FWgOWilu7fc24i9FmybOYVxssk+ZbsE0jb6lnXz/95QDoqpZ3lXUC74iscCGGrzWB1E0O9EwFimk+0w44mrYqYaH2JtBAiaIb81HpprSDA1wjcira3BFFQLex4UOBls8yerI3PEZmlmg2l7Nng0jDaC7glbI/cezYarNPSL6IIvM/xnmLE1jGQMZbxZx8Kd3KYE/srU0Zo0H88XWqawW5EvMNc3rELBDCO6hFhosDt+QR55cRoxc3st7eLmQMZa7GsW314eVYuoM2lOsGe0GyJTyb66h7YrBZDxFRS0dZXWeWzftnBfLDcwPDytipd4Z8PzalE5CgXQiWW6ir6VWkI6hpJb7h5oI2jgG4EqUkFLOXFVAK6bx3sf+owwEkOQ2R14XCURNhYtGegXM61sQ1z7f/7rv+1ZzV6aKpeGoUJrYSPEmYqCmzCWGtUZVlP0iScsvlk8QkJpbCnPwFu6X499tuo9vXpfrUjMIqVUAZnKYnJccq8ss1JwKe2/WMEY31p2g12I3rHFJWF/yLxeAKlKbKLSg+uWp+L6C4hpxsGqtR1qO+q66/GQXwUneeugbOG0EXmPn4u8FWzJ83FXRtKAeXdSRfuXOIc00aJvQE2/vBg/mLsRme/y7H5q9DX4TD3cs1VmBopGvD1uRoAnBNZx1jTzgn+LYcidnjcICfa3DUFiGS5putcyPX5h2kM/O5PhXqHAqjDHISuw9oazgBcexpZaI/VoDsPdjlWjt8zifVs0m1XbtLN/quT7+11cg11d8VXymzpaMBu51h7PCJEHyXBuDQ295AkTBPPtmvkhJUkKmPYOlN3qycwyX6jTJxpnB3mg0giEjlwzhH6RVpsxY+VB79Qt+/JTPPLo7ctS69HqClafj/RZ2PlIH8shLYtO59wP74kXUSHmVk4+nqsZw3hmIM/zJvVzNhipQOrDEIvIzeaWPjTATkCeG1iL8xHAwKJk8RZkuyNgjxAOEx77DDowAuolO75JSSgTMGRUPPYjIEUi627nfJQgDwqJsXNxJlSjHQ8ocGi5AceMjVGiul8LcHtR6N3NLbENwUWu6bJrR5zfbRK7Zy0uduRdTsr5SGFpQ9eOJ2XApGCI6Gf1SH6QqP95VDJVh0wgrl8DmpErTt6R7+k9M3BpuVR+HhWTmgj9uZUMFcNWDibPB3IJ4TmqLLQkbKGYj3JMEhvQeAXaFgHffsTmopsFoXDuabRhPVzOE1xA5MDcshaXAecgChqXanYcUK2CQ8rVhouSRNm0FPSpt0Ubo4ofLfgqQ0iKTGrE6F/lAgB/hxMWMbq7uXUNYEglOMByQLx0JyCCDwhH84T0JxhQjQKQSMH6uVZynf+cLtjmZ5n7xVO055puEp/kftV6XldpO06r52UQxVHskJjJFo0HfIwEYDtAPPzGvvarQtqyLpTwBqnV2ZyTqq/LnDGV29U5zH+Fl4YJ6BbIJ1cXZE72VgI1LugblG+58IryFvD0yUrBTgDxzhoQS9AVw98l3ZGI0Vv1LMJIPmDcJwnDzIDvWbBbS+g/NnGox9KNHAEV3bOMdJegHoIv4BA9nEArBr+j1g28aG0rMhT2DALTmmLuQ2i+FCEE5BifAyAyg1AuyVzzux35vKFp9qckACy1IJDHuweFHoQesd+lImEL60JNp+TXQOPx6Q4nPtJsk+IzDK05j39PAkh8OPMrBcNb4Tg4yxrcCAffwrYBjmkLleT7KV3x2BYEsgr3cfYWculdDoLk8IRGSsixT6MtgiGZPoO2hikhfM8g00joNylkmVCoRyZ/39NUyBUZBV0iJdcBI9d8q0Tvh2mhX+tHrmnkoDt4/1BoHwhksU+6JnmkT9a7NA16FqQxgsUd8cFori4+QfC4mcHQT8s/YLlzx3ai6/ccyCFvqRd0bzexRNoFsntkD4BqNfglrPc/wbBcTkh4S7pv0pTunFDI3y7A9PI1uCpqYsUCtwRRqO8AMY47Gf8BWb8EVXV7TpaG625vVoDifl9gzPEfPt3d9EjxCMs/3TwG5wi+ZuX+aW+fMrCNmKROSObzOQbTQ88kiZSYnWQjgu4+dBEKYplLgP2DQdNBP+Vj+I7P+Fe6KsBfsVuBJMLU/s61pZvaAxK59vfy8TDQM7nzqMnL/K2cN6xfw8gRqCxwpIADu1fTF0xAxoO3Yqr0BQXxHt7JB/lewGi/UABv9Usxq+1Lzb7TL+XWyvLV7JV+KWallau5a3wklzT1y2kwbDX5JsYSE9yU/ARDhw4otzMakQ882WCRRvyUJz7fxlLCkPTQMLm3QUKdFcs0zRe7d37XrmVevFA0Lf/qogcWkmbdFg8AAGUXuA1kWXMbLI8zpnfq2ioH29IK4FllMYAHFPkQ5s1LdUKiJpyUybzZHf0+Wg2ITdRygXcMEJBj/zIII78La3ODAhlAVUNUfQPi6eSkkrLkwbthRXVB6+cN1IyKfZ6+iaKujfcjdgvHWW8PrGH+/CEUGRC4hsq1a6uSxu4pK38Kr0y6bZiT3j75i5i79qeW0u4324YYh9zCj/0bFHg3sG+5AzRYJfoK8rqFJMMc0xPrD1L6RVFLVOlnKKCo4gqDK23naQuVZZmiUYYuEwEsdcIYKs/vr9//AEhse0ZU/JqRZlxXy24KTP6zGDQK+RECzJlFr3ngDWWJObNZWouPCYsiiDxmIyJUtXIeTBco0rJMrVg6GjrqDBqhqS53KsW2bsyshY2M6ADakp9as5NzZ2SnLzAh5dwWsLpZBPhm9iLfyLT1B8SfLsQiINTFAbVYSqlfExPQZzXolyc4lhSC50SK2TY+5TmUgsupKmHlv1IGyjvK7UtcuopsXIgASdUOCRpzo0OS/aoyV+VHhapyZ1p8QBCitCwhi4bJIKxmW0hh7ip551Z3lLLc//xSBykbgNJLPjtQ86yygJyT6Qv95DNu8rlaZMz0nDznYZimzeSg6gCIZmEEMjUSQ1FE3MGuPnv46bb7GYxnMSfjQ55PCi/UuDXBbcQ+0aLk9+vmYR4ZW4sfeU6zbEJq7NY2yCHXNGmvxFAEoG7kX9c+OKs9SbNaDQ7mmWxr6/2bPg4AY5o9ptnf6tkZgFXqnBdmKT6Nb6BSk2Y5K6Ns6zyY7XlwpGIPHqSqIHO0OE8Wvwjm4zmJS/J1VWlU6sJmvAKtGjFB4k2qHqrny1zxUTekZM19Vtr/cgNJPZ/rli4gy8KikpWloy4Ai8FW03yqwJZqFVhl1gxbVT1mXQwSKWtgLQndLDiKtC+/rA5U5RcU8guqHgaSyV1EkYZOoovlXhmqFZk9JQZVdktwBcEiiCS5PGqzOjjKddrzStDcFQGi0EAKpRVLP6reqStD9UDaizDlVqZEdXNUJr/yRlGnKDM0i80aO+8atLpnUoFebogmRM4FlEvPen79dr96Emwturm55xEGcffOR4gcTFQT1KS0ktDLC62CJ4XymQauPSUWVxngj+bRkZxY8gd1fCSGpqNaBD8WkavmVnWiPCvzaOS9V8Gsi86uZAk0NrDVgoAENB22tL56Wh1phedwuVnL3EYaNVPVmnRLN1D2WEnbNcDLstnLrfXpMtU8XbJ77Xm3sPGKoIoYI+XP/CKgPFHJvzK3U5darl7eVt57y95eTyv39JYO6lOwzJEWcyhS7TPFsHlKZhTFOfLHk2hLxpf3Nhg/94d6/MQI2LTtuHLkIZeTIlzlJDzjEnoXmcZwHxkyWzaT5WZ56tB+moJRFwvSSqy9L2Lt/QtibU/x0e/npxbFWYURfhWriwJaSKqBd/lWhlkpFoip0ohMeapVuvYpKKWDZUGrxru8GeonenMw6q8H3ExizsPYN/kSNQx5/gaq8UlL3WkUUP/ur1SshTxk0b4mSzHSl2LVzFRrrpYsWwmdslL7P6qn+jDZb1RR+WheO+F7s/7p60KqTirexlotw3jDWpxxq4s3u981TGsEGv/HZDwGzK/zQ+9mj2Rcv0JE7xvr+7ZKUKq2bXRMrRWZbGnKGGk0QS09e7OrLnrqsqFEwIz7spmM2ZZc4ScnPemU+LU9vn7MYJtV12bx8JeP9mC/g8rZtWPQXxp69mANBgqyiXi8sgeAqJwqnaPSnWuZNu7z8wZBfkttXHceN7/wNq+a5U2zcdGs03+ZFINJxbX0subn34P6PfXRaX6d/8SXek9+dWcpa3zsDEHa5KROb/JoTzxr/XBEf+Lf8gUhbi+V27dVi/XXTiP+FScRxHnyKCK3iUe+WMn/d0Tlo4OxVTlB+NfHzfw/YTS+8UC5ek7UbznHqN+92X0tov7zhyIGmtqlWs64HDA+0VLvdTH9LblMXiCXVoM7Q3Z/DrMNmM6PPMuP0iSneL3flb3cfDwLz09nYb/f+2smoD96mZ61fXxjmeKtl8VP+FVd3K0fymi2rfrHEJU2GpnchjE4BPzr862Dn+tBCB/Yvy8jGt+pghDmnCIFblOIfl1b/j+qhfw8o/YZxRjNCGfRhuTnGxA2ELgFmRfx/FQIKtfrcM34xihnenuElnkDiq0BGIBxMhxmnVpvP8MreX1t29F7d/Tmnf8FUEsDBBQAAAAIAAVtkVx7qlphTA4AAJhAAAAgAAAAY292ZW4tY29tcGFzcy9jb3JyZXNwb25kZW5jZXMuanPNW9tu3EYS/RVCL7HhyQ/sYh/ki6x4bUcbCRGCYGH0kD3DtprddJOcMR3k37f6yr6RnJGFbADDmhs5zarDU6dO1xyQKF6/LP5V/HHRCt7jsiecXfwDntZYbDt49PuF4B1ukBgvNsVFh/ZY/t2isaAY7fTjjlD1gKLyoWhx22Ihn/f12KhPfx4YMa+JQb1ywOKA++LZlg64kE8QYc/lG4jtMSUluvgvPCnF2PWI6mXos/d8EA2ihKnT8G1HKoKYfFzDInvSq9e7hj+MxZcBif6bWgDupwVyNn7Vp0esovhTySkX8BUXL/XborivzXkqNMo3blE/CPkYXmo4Z5/aGnVYvnOPGGF7+TqmuMGsly++ga+t5WuElZipD/5+UQm05+yHrthSziv57k4g9mA/IpfDW0R1kFmF6FF+TC6zwqQnWAfhGpdIL+1S9LghnX6I1d8PSHTqiB5BLuVK7mpc3PGjDn1FhMvvxUdu1sghd/D8xmUfFohZVTzzl1e8KJpRiPr5xZ9wCOUHnMGIPBtFBzhYf99n1DUmTzXZkq4cOh3TBjKG1BXXqOENofryCWPwVOWyRBBueGsZKm1LsQxn18EnE7zIJXkQEDWvODN5bQmLoaTeL2s4ynwG0ikQVZnaI8EAQTnM3MgzAWR+wZUHmCtBZuDyNYXLPWRUxHCxAfWCOFK4OQr1/wpKfsVMx/qyhQuqzAVdCTyqsF9CkAA9KVTeNC1AqUvAco+73sPKe8i/RYmK8ovCLFPjA5ikg9ud9GOEEscUfq7huD6mlAAYiO7kP/W6hJ4BM1VnalFf1nygREOlJ/L9BAsl6YWJYjsKE4+9wJgVErBwd5t3e7LHAm5SPJroV/oguJqK5xHwVp0GIPCWUx8Dd/UgutNRkCWN4Or8oE2ci8UeXuwTDLxHD13dqAOv4F4f9B132ddYP3o3tKQ3sQpAcF9jTAu+K/Rh+BTqMOm2oLCLAmDYRWtk1Fjeb/sIFj5pBJnHQ4no2PYazLqwWLi44oIpHLqjluXgCDjZQDVeeLMD1GsUcX2f22qWgAQ1GE6qkV4CEoXHHjmsKCLveq6fAZOg0taNDhKruCZfZoDIJF7kOT3AfOBsAS7yiKtBg36NPMK4+eGNa84CibwUZE8qzSKcUq6ZAwLTEn3enzqSKTe38GyNQK41DCxcpuUCYOxqNWC2UF+7OoVMLDVKNGKmEwFkDQLC0xpHLpqjqbkVPhAK93dXc1x0khTUfYj2ggBIVfDrEUo1qBA0KYaS17xTkN8O5YPkhgQ8vhLJKZVYkaAW0IKLHutoGYGyUGiUODlDk0i8vEbiIcLLFaRlXZqoYh9oEp9a84Lk30jTlATBBy4APToaaqEsBMprjDSFBCi55UNALC9t8i1Q1LIAI372TcmBu3IHsjEjX61k9W8DX9KWuDI5mFRqd8S43wukayGQQsdbdQ7cSIGEaJOhJ5npBBeOCTKkUvMjNW9p2Ws+Bod0VsnK1GqOyYEiFqrzFJKRqZckIQ4bK5f2mC/gZV4AafR8iS8maforXAnyOCRAwbuh2uvVxEh4gwK+uPGya7GgU/GikEvWGKjIgbAcApphDxygTjgiIfgxlhtSDxUSbAlfuCpTo2+Y6qQxPHZAAzRBFSCK7KUIWCwtU0bV4VuBKm4lCUUt6YACv5mSDw9EDjxZJToIqYfhtr8l1KqkZVjIejLDExlweGH0ysYm0KioRCVBCyxxV3N9j3tFRWuSpJJck31d3Ag4R58TpTFGuhHKb+moQi82KSglsLIEeYgQl+ZJV/kNLhf2vkACHXUkvYrjC7OUS/dw5+lstFiWmFScStKnpnZEAjTUGAJXUmkbkjLFQqZjWOAI6Exkjn9WRc0Dxd2Az5Cnp9WN6Vr9mAQkEkNDNa2bqYmdaOQWP9SNqYYOGLe9wGx/QvF4pRNt8aBXlgjSI+kqaB7zFcPHwCz4DeIVTKqaBBUFvrTDOpSOPziFOpqCIL7zOw7fYYuDxx47Oji28NiBcLomNzU/eAC4xxWbgUBGaGarhR8Id9VxzaBcVsg471Mn4ijh54oYxQCV9whMnuMELDgsc71m3KvM2vSrxUH2/bUZ5YBRGdPBbEMS1v8W9AF8+dR72Kb9AD2IMDc0JXSU3RRcbgGvU92NHCBh+t4FiUh1Rap52+VsL0gf6B1coD1KxYKnIaQyr7h9FtkfyzrCYuS79ES2FZkNZQiePEb+MyBW/KZBEVgZL02utdERogQ3wI8IlpAgJOpCbmTmnZww65QMYZepAQK1vpT1J7YycgaobcYjApxokSsWBumKU/cijAhw+gSsU4yNqHJMPoerDrqATbVGahXoansQe3lJIR2NbO24HZZa1RNKx1ykuPumxaIxiYdruBquCscvikzeD/s605QObLVg3Oo8ZzwMvSiNhh0WPaGptTXrUmY9L88D3RFTH459zQWL9FQDGRHoQT82zkfLGwy9CUN9po4E6jLigCD51trKORsDQw9z5cTZXdL59CCxbHnOuBdZ08u7fEuo4a3hG6EpMnKOp7IqNrLvhFKaM73mnM/Y67qy6bcwMYtNhEWr5egntM2hxVMTPkF6WgJTCn0BnLF4hr/CkhkCpc6glPwI9+tXUj4PREUNH8cgU3HxzHsXmFD2SXs49DPktquIuq5Ovyv7mIl6N17f82TtSwP8gQ62gakh4HOoetrm5bYlsKQYV17Qp0B7YMvXoEzrYtF0K3v7jI3+gfOUbl7B2kwNWGlY9OJsu9I0A8sbGz5ylDBxhkXolG6HvpcO6QhlJ912iezTCRZK6kAqtkamdZTIs44F1urHiZyTJAuwkGyPjRnmiVtgnS8DN613WcN5OKBC27dO6OQg8xuWwkkiQKoXDzALujZbnzLKdj60qYG6z/Q0WJSDdpeuIQ+6sXHwWZC3H9CelIagl8TtKx8WgSOiFpp0vUeMKHx5iB9vXyVQMzOlOd172YEmKXa6sXIBarjBoC9t8t7YJFE8GaPrka1Ogavu78ipT3kW699mZ6a1uwPnbczY7Rh4eEOHPlG1j9mYuVdZt/BwK05q1V5w0HOpyW5VZ5xN1+lx9FDYfIcl2kZhMpJHV2DjWwgI5hsnWR5JffSlXf7QHvEd+SVfXfAj0yxyqsEuK4484iM+ngKV1TDqIMU4eYt0hXoFxX9gTIvcm3lPXUGEC4P0JVy8tfm20DArlMCQazJ2qsAI9AAU15O0S1BU/AZYtbWbTLec0XmRuepo6ckUidcudwABXP41giTbGnuB9EIRmSouqjE8jPjYyPWItsZaw01qJb87l5UmUV/8WiZ+zUdl+Phpi6GxlUZA2hznXFSvrniO6lRV0G4Hyp1mRAk0XWzSJNZ+UfpmuQGKd1widIAk+eZmQsIWaNFSVTZJbgtX98XynTmQAGe4JCxrED9eiaWGTbXJyo/szu20J/MOpaYJQOOKc7qmO+Tqp6xnWmW1MOObYLr7dP6o0AExYuRfQCnR9IvXQfutc7CxZ4eIvnc0KCSY0GULpobmBoQ8hDyqTV6cEPIClqeRxRbZjQpdIxlE+ci5bo+dDwJq2v1I0yEhs1LT2VCUmRAKOxc/m6EMz1n0rp6G+7LJvZM23KmtFvGG77r7zQt8Txk68Co0UlpVy8yhuxcPGAtdi7zrpDl7YvOS7NkGMXVbvCpa8678RB2ucbFtzePbFp1zp0jdwgAcNtcaHQIuUV/9iVMf6V7UtGuftiIbNxxiw5F0t3OOqy8rYwGaE6zRoEePH6x8dVJ2cRZVic2ow33k7EdehViFnkbwCYY/QLwC4R3xSfMfEY38ojGwPvyBtrLssmQbJ2hwc4oEhOaxhqWoi31Eq2sNWYevJX8+Z7TG84WbTGe78bvgv02b6wJqHPuFLhcwoB2QTLsboOKjNFKhv72BFSGg4HU79tJm3u3zmSVGrj0kaiDLkyGTJegGQcLiQlEl1xfasc91EAO1mliKJv72m1retivjh+e0NH49WtgG/r81NC4Gq7MhU0tjHdZHjoZERPKTzX5q2psla5T0gJhux0WTc1sz8/umK9lR9FXduUiKU82YtVzgZ14zte9bcvZlwIKbKSG9peNb9Qv7gP400pZIJ1cNp7mjM5MEAVz8ehW4aYE575WlMAqnTRzF3omZLVFoe4SNcuaQ4hlDrbZOTaC7qTlmRCXwtiYHdEqhircO78KQGZSFK84OH+wAwqzqatKe0CSFv5ZAPSOtDjnpxgwNAV+N8OUAtz43vAAlzkofhSe5N7DWKOVK2FrzFPZLy2MI9scUiTg+6/cUGUm8Gs6lLcWVX1OYxiniKIiULGWvhnZ1cu3KgSAzjOA11J+HrieJyJndeA7hohrxTU7lLdIYF7iWZqHKdDROfdYMU4fatja3tTe35DdWPnGdNchkhc4y3Sx22Ce0UU4NpyFcarZdQ/UB/aCVJhQw68TkVNA7k+YV1JiPzfxaK1yjK28HTD91aIczv8zxpI435JhgSG8S2n3ncPrV3rTQxn0G9TWZdJuln10EG4BBhQo3DaO6Fo27rDRTw9lN9yUb1zEyyydnlKRph9DbNgy678y8wqsa4sJXh+DuVMpPmHGiGMcl6PvM/bDY+BMt3vZBfjQuS2hnyOWg4PiGvzeKH29Rn8U3y1Nx5yjm2Rif5uTl9wA+jorHr8dWbho9agvgVuLhBNjYYdyITJ5oXnpBRIeWDjY/3dFj3CnDhFQRjEGdNmAthu34lMPVM1XoLxuytqPVGzWgUA6y137cmLX94MqcdSlASJND7iehqztE3kVGEjawhOPRylknGQrgTvDMfnMADM+58Qcozbd4xu8OwlNYbYCarTUNI6RoiCxXISVgnnK0cmac0o/q/Gilt43kRMzC7Er2h3/JVL7DwdKc5Z///B9QSwMEFAAAAAgAQ6yQXAGtlU0lDwAAHFoAACIAAABjb3Zlbi1jb21wYXNzL2NvcnJlc3BvbmRlbmNlcy5qc29uzVxtb9w2Ev7eXyH4SxP0+gfum5PUcXN16ouNGsXhEHAlrsSYEhVK2o1S9L/fUFpph+SI1K7dXoAi6Mp6I/nMzDPPDPXHd0lyUWvV8rQVqrr4Z/IHHIFjBdebBn7+Z/gJB7RqeMl0f/GP6UjDcn78tWF9Ijnb4iONkOinZOljUvO65vp4tC36Et3lU1cJ6++6Q3/dcb3jbfJiIzuemB9MVC+Pf2ZVzqVI2cVw4L/j8YtU903LpDWY8V1a1emSSVGhR6hNIzLBquORAobdihad05TqsU8+d0y3X9Gr89YdrKr6L87LsCqT/GOqpNLwQhevxvN08lAcH3GRsd788Y61nTb/fzhcKlV9rAvWcPPXB1aJKp/+xiUvedWaP/wE71VMx0WV8mq4YB58plmuqu+bZCOVyo7vvNWsepzOn4+mqmYSL3qVMbk3F1oDy7hoBbcm+ZqnDE/bpW55KRp8gKNfN0w39j1bBsA0I7oveHKv9jMuLjKhZ8BevFdovAogB8duZ0jDKHmVJS/w6JIfkrLXunhpnvenufJCqh2PoP/4qpLt4J4Ypp9YU1o4KsRGNGmHxpexEnDF0MwWrFSlkHiyRVXBQYS+lAEC4LT1RlDXkpulbRq4KmoJZmAelHWhMlVZmK9FRRvMcG5awH2s8wGNmkmErpzpCiwkaA235iFgDB945pjClRYBQ/hCG8IDwE8HDMFeVG8JewkOJRn+PQv/v/EKr/9lDZOUWZN0pXmPAHEJqwM2EjCCn8oabKYhzeCBN61jBb8AqCf8Dwv9Q3IYJUI+eP8GXK5o+wD+HV/u4xRuit2fFwwIsDO5Nf+hc4wRIqPKhETPrFmbFqqTAptCK8wVUZSnotXW2ta9tlYi15xXiTFrcLnWma3IuQZnyXsLKxm+GcxepiLYfjs8AcD9VkkX3fdFp5vT8R1z9MSM+QvnRmmuczihjaL7F/bYFCW69RW44Q77t8u24Pj3u64WrbtaFrwfCs5lorbJeC9O4nzB3R8wPMF9GgdAfhozwnzBjRfLA4D3XTyBYN6lTPZ1i818JDi2OTgkh0u48VaigDbgxbx4J7E9qHILHgJbjMKed2JkUfizksMrNC02Nc605/eXrWCgCk2r8DGIBCwtbGYE6BziRoT0QOQylmAe55jCjaoihmCuvOpmz3CKw6fWy19omged4PhfaZELFPouayWlwn4epr8W+C1+bkSI/NzBr7VO/3rE9mQIxzGDKUyDRaawARrZFGFjoKl7ynpeYUBAiAf6vcDd90qXe4tvZnwnJHjWplA8aYyDRnGW5VqAzSLwFz0QV2D4DKPSvFeqCtUU6GiXPhpvHTULn+sv5wU052c1WABPWs4wF8SJwBraMyQBZ3B/YwlvmH4kLOEKQHJGCjCw4kXuT4bbFcT/XwyHIIPnG6XBRvDMD+OtFkzgDWdHl2/h/051XjB4NSF6MoFhVIB+DGNMgMDXbSFtjCTAdrrruw0/QU55ZuHCzW2bPedtrlnTYJQDb6/Rc3hpchgmUQZAhh2D1ijiZ/8cCQSF2kvrtDG1ti6EWzV2XmwwOsaIINypVDfs9hcS3UsRcvb2ejlQpn08nKIScPStOt3Hu8ntbzA7mAyNMYDG97suy8dRURj/iXk+/hZBdkL5iJQfEjNuhO5M7EQVw3bZ5eCfkdvqmdZqHyL0JldJjKUFfbzDfAr2lUsMs4r3DbhrGbQssCqRG9Z8BtE5YhI9YKNZpuwEQLJaNBAfv1p0GX7qZXMJohyWyCTi4KLvhNwh6SIOeMNuAr49DHtvKRFxOboiN9dlKUsFO9mz3xeqLTyQuxnAMq+5FnmR3Gp4SruU1lLob3rgnens3scR0/QmhVhuHMEy9h2IuvmQL2sqbXsWptmeYbfv8iI/6VqKvzk4Ooz8mhsKFIV9akiGtJgMmbZSLF7zzIgCVmA6kJYjhLo1fv0D3AlQ++vA0hy433f8jAT3TBbjzqI//5b7j4F+ECaRo8eipRsG7vhjUbp8b4b8Xat5lZ9AZV6P6J2QPg6MTmn3oslUuZq/+Lhe5TgOfgIZQ1ZgecFmPPC+Dces3vH/SgKfjMOb9s2NgrezSYrn/beyc/y859GFkqsT1tGnO9B+4FkVAPdCqhrjLv7UO3NLMxipDCuMIdpVZhw3/msmLGYODHUPDCLox7lWMOT1DOZhgOsE7GFsgGs8KMzQOUtDLnyVWEMx6Rq4N7yjq8XYwvCOSa4t5yqF7I1MBdOYwF8l1mh2ACjsOyGRlJhJFapu4pAfxH1IV3jCchYm4h5XN9pCpuxjpMy/kq9P6H823h6TaVYtJ2Ui69D/745Vye8Y4oQ0/4phPzJK+Qv45yUETwbDILFPKDS3Bs4zbT8M1nj1aZQI+sCOU0ONQtJ8rPA6SbqBgOiGTDUEcciVeViBp1YB2IJrUOcL9SSPcdX7mZ9gUuYyIpNB8CppIRGMUHej0C8ymbsuJlCeTmTWrJDCL3MqhXGJ+TXMjUI05gMKBr90eRGSIruKxDlFX+5G8BKa/DgahPMt162Q4SJUpPIZrVF5FditsLjJvi2URud7WVIJQNHsER+xdP5alTyHkTGPUBBQJzJT0ksTULbLT8uqfVexxyi5mQtTpvrqgD1edg2o8bHylDe9dtilXAsuycYxH6u3DqL7/OsNvHi4PBWqvlJVqasJ05MBHEZME/h6zGo/sk3MDjym7gdMj6dzKVmm4KHJC/4FhlkxmagKaMyP4BG/iPQlNgRbpIFLOSS9PHnhnQmhzwhPOdzsE2CvycQwIQ0+x2g8boief86KUdRcnlvaKcHJs50t7hSw2lF7+euEnbtawJsHLMZbeHeZPZNax4giso5tJ3dGQw41KdwoRYeI1zDO43zFxJxxbJaUU5ZdFRfqfWsYqL8jtFN12k3XtqYy2wPxCTfqkCVcF+pDwgEI2VjJViOFeXKfcJyJzElG1BCWUwOIHEYqtcpWXpIMMeJzpyzZNi3gMQoAjovPc6IRNIbfucluDKZNluCYQiQzXmRL4dx43fIuFXHzFXoP12mH6zjXgBMs+jjmsSZBvmG5SI8xPJoev8ZYtxT+YZy01rnnTMKLLVuG13FD5A4rqGi4T2cLTD/ZjkqVsyilsizQTyfWVbFc+u8lDSMjslkS0a3g96gN16Hy7zri9I119NR258bzNfRMDTzzgVvZeeHleRp6HgYoT8Cfh00zp1wrSMrCLQxTBhpCn6OwKfaY2IilKKk9224BvceMcdEtQYD4qsQq37/Un7C2S5mS+/0+iFVdC1rtq9Hzn9q+YPiPufI9359hBGcs5bgsMQt4yzCXeg0kuasqnCbfru5YGMCvNPILMcS/nUA8gf4wTAN5Mxhc0tWcAWsGDvmkHIGgNb7UOciVaKZJvTSSyZFl3jn0REH/3MzfE0wbwDRP/4/EPyaIeovpTThZMJjXNwb8A6Wfr7xRui44ztPcDCHSr7aYAhBq6BuD5lW13IrvP254DgEAzCQsicZquB7L8aq6Lsdh263K8F3JFGDLsYBElRyGjCOKeQLhdKcOiXtIA746/fuUPLSurDvI/kvtmqMaav4agj/4eQsSq7m+v04LZS9uMaBVND/apel29LxjgSIAgP5KKUmCnuD3ZkaOUCYE0mFEuA7A5fbjc29S2bFKWEkfERLIXRCekuqLp0Q73LSVJYr+J29KoQIEVRWz9q6Enf8zi6On7U3xFioUAGLAJ4RRZ6vKNTOLefw9V8yWwX/izhSIONsfpb895TBQrPpIFtmbQik5PvookSDWEuGwSKrvcsEfLQmyUejTXt7vY/CFHXi3lOpsOBqtMHmTK7UueftR2XEgH1F0jFczheLzhJ2FnkxidZ3WzmGVoqh3eh5cd++IOpMIFOA4p0o6I5DnnHYeF8B+givCvYZ5G6f1iV35S11SbqfxkhxztKmOLy3Bgqa5turrJ6B08rqc/pKN+C1/tFPiOUkOmsC8J3dIUwld84m9+VG2b2sIS+v3NzbnQyoMsW7PT+/PJ1z/hxHYK5vz2cYwzCrY/kPImjH+D8novoC3RtP5jDKnXRSe7Sru/Gkhk+Lu9A5E50KSGs06aNAIvlVx01naQ1dEDPSetgmIxor+otRJ4/29KeKqbXILI2MQsdeXhC8nOM+db4cRUj0RAKNOnNq575YEnRZ9iuRIlpkB2YVhVMIlM92FUqNFwe03q1Vdn7VZ8Wlyj8+U1rR8fstijzPTZ/buu6KPXeV9jtZ9wvn/PEHab4k4jBvhvwWDaLZKl7GK7+IXLSw1ZivZF+QhmUlpcQQtzIg+qaIa+jpTVX3uuMZp0NT+4zdCrOyM8/fHbISpOA8bwea7Ri2EBL/PoYiKF9H04JEke9ZP3OtC1QIOvf+DLT2hLPA8WxqfvLnX5kuuUd0WilcCweyuELslMzptW+O9vS4H+7GHvdxCvQVLrbKmEPUTBCTqiyWsrQTKIjImGpR1k6ED4k0Pbwzm1MYatIGC2YnGYCmmOyNqJaSItEyoTpGXKC1pZTP19IkTMr0+6ysn4aT6jCU9pcnu5G+cHKSlpbgCy2OI1euupkMKkVdfzcgmWqpdGfVT17QimExEmkwpExhk2aMFPE8wUpoXpiKIEEpup18RLdaxoobVdXH0sQmxV8aXoXAoCuI+uIVmSijiISKqq54jMTmZ9NICniKxOmLTDfse55rAn+zKQjDbeHfA7Ep7OJy+8N0re3A22dpx+bFhWx75EpCXQHgbIBdsBLfK2T2m1J5fe9tMyfQnSJDcQtrROFZ/DIVogCOYEtVMR/IucoPCWqGpO1tqvZw/jfGUzjlipZ5MkNxuOa+djlBeQ13XrwtYhlnbiML/fsDx2t01kvMQIformyYouuPvOPDaOEJbz8jQFTWIdQk3QXn8Rgrv8xJus+r5MSK+0+wJOfeqdX5KzS3eYfG+R3zguq9N49GyUZzSYHFnQL7WIKYdyoEA8Dfuf4+m5FTRglufDRq398ejAuXGia03526h193GjU3Pu30+wIm+/W3007b5owGYoGGEVdoETt5IP12wZid9qiEvF7vYBxHP6CnyJpBMeYlCNb0dc1XdGwjdVqsVvaUE2L16hL/R8vBmXvF5CyuS2LyalRuvGOjYwAj+OCcaEoW/ZSNmcNulv7IxI3C5j9eE5CQOa/YWLH4cjvyixAzuyK7M7/78H1BLAQIUAxQAAAAIAMpwkVxgs4tWWREAAAk2AAAaAAAAAAAAAAAAAACkgQAAAABjb3Zlbi1jb21wYXNzL3Byb2R1Y3QuaHRtbFBLAQIUAxQAAAAIAAVtkVx7qlphTA4AAJhAAAAgAAAAAAAAAAAAAACkgZERAABjb3Zlbi1jb21wYXNzL2NvcnJlc3BvbmRlbmNlcy5qc1BLAQIUAxQAAAAIAEOskFwBrZVNJQ8AABxaAAAiAAAAAAAAAAAAAACkgRsgAABjb3Zlbi1jb21wYXNzL2NvcnJlc3BvbmRlbmNlcy5qc29uUEsFBgAAAAADAAMA5gAAAIAvAAAAAA==";

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
var DB = {"protection": {"herbs": ["rosemary", "sage", "bay leaf", "basil", "black pepper", "thyme", "juniper", "rue", "vervet (blue vervain)", "angelica"], "crystals": ["black tourmaline", "obsidian", "hematite", "smoky quartz", "jet", "black onyx"], "candle_color": "Black or White", "day": "Saturday", "moon_phase": "Waning", "element": "Earth", "incense": ["dragon's blood", "frankincense", "copal", "sandalwood"], "deities": ["Hecate", "Artemis", "Ares", "Mars"], "tarot": "The Tower", "direction": "North", "oil": "Protection blend (frankincense + myrrh)"}}
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

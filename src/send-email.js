async function sendDownloadEmail(env, email) {
  if (!env.RESEND_KEY) { console.log('[email] RESEND_KEY not set, skipping'); return; }

  const base = (env.BASE_URL || 'https://coven-compass.allmind.biz').replace(/\/$/, '');
  const appUrl = `${base}/app`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Coven Compass <noreply@allmind.biz>',
      to: [email],
      subject: 'Your Coven Compass app is ready',
      html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px">
        <h1 style="font-family:'Cormorant Garamond',serif;font-size:28px;margin-bottom:16px">You're in.</h1>
        <p style="color:#6B6560;font-size:15px;line-height:1.7;margin-bottom:24px">Thanks for your purchase. Your Coven Compass app is ready — open it on any device with a browser.</p>
        <a href="${appUrl}" style="display:inline-block;padding:14px 32px;background:#0A0A0A;color:#FAF7F2;text-decoration:none;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Open Your App</a>
        <p style="color:#9B9590;font-size:13px;margin-top:24px">Bookmark this link: ${appUrl}</p>
        <hr style="border:none;border-top:1px solid #F0EBE3;margin:32px 0">
        <p style="color:#9B9590;font-size:12px">Works on any device with a browser.<br>Questions? support@allmind.biz</p>
      </div>`,
    }),
  });

  if (!resp.ok) console.error(`[email] Failed: ${await resp.text()}`);
  else console.log(`[email] Download email sent to ${email}`);
}

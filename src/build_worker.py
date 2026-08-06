#!/usr/bin/env python3
"""Build the full storefront worker.js from components."""
import os
import zipfile
import base64
import json

SRC = os.path.expanduser('~/.hermes/mvps/coven-compass/src')
TEMPLATE = os.path.expanduser('~/.hermes/skills/business/mvp-storefront/assets/stripe-worker.js')

def read(name):
    with open(os.path.join(SRC, name), 'r') as f:
        return f.read()

def js_string_literal(s):
    """Escape a string for embedding as a JS template literal."""
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')

def build():
    # 1. Create zip from the entire assets directory, inside a product-named folder
    assets_dir = os.path.join(SRC, '..', 'assets')
    product_folder = 'coven-compass'
    zip_buf = __import__('io').BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(assets_dir):
            fpath = os.path.join(assets_dir, fname)
            if os.path.isfile(fpath) and not fname.startswith('.'):
                zf.write(fpath, os.path.join(product_folder, fname))
    zip_b64 = base64.b64encode(zip_buf.getvalue()).decode()

    # 2. Read HTML files
    landing = js_string_literal(read('landing.html'))
    privacy = js_string_literal(read('privacy.html'))
    terms = js_string_literal(read('terms.html'))
    app_html = js_string_literal(read('../assets/product.html'))

    # 3. Read the stripe-worker template
    with open(TEMPLATE, 'r') as f:
        template = f.read()

    # 4. Find the SUCCESS_PAGE_HTML constant and insert our constants before it
    marker = 'const SUCCESS_PAGE_HTML ='
    pos = template.find(marker)
    if pos < 0:
        raise ValueError("Cannot find SUCCESS_PAGE_HTML marker in template")

    # Build our constants block
    constants = f'''const ZIP_DATA = "{zip_b64}";

const LANDING_PAGE_HTML = `{landing}`;

const PRIVACY_HTML = `{privacy}`;

const TERMS_HTML = `{terms}`;

const APP_HTML = `{app_html}`;

'''

    # 5. Assemble final worker
    worker = template[:pos] + constants + template[pos:]

    # 6. Write it
    out_path = os.path.join(SRC, 'worker.js')
    with open(out_path, 'w') as f:
        f.write(worker)

    # 7. Inject /app route (product-specific, not in shared template)
    with open(out_path, 'r') as f:
        final = f.read()
    # Add route before the 404 fallback
    app_route = "      else if (path === '/app') response = htmlResponse(APP_HTML);\n"
    final = final.replace(
        "      else response = jsonResponse({ error: 'Not found' }, 404);",
        app_route + "      else response = jsonResponse({ error: 'Not found' }, 404);"
    )
    with open(out_path, 'w') as f:
        f.write(final)

    # 8. ANTI-REGRESSION: splice project-owned fixed blocks over template defaults.
    #    The shared stripe-worker.js template ships BROKEN placeholders in the
    #    success page and email sender ({{PRODUCT_NAME}}, noreply@yourdomain.com).
    #    These files are the verified-good versions — every rebuild restores them.
    #    Never edit the shared template for one product; keep fixes here.
    with open(out_path, 'r') as f:
        final = f.read()

    # 8a. Replace the SUCCESS_PAGE_HTML template literal with our fixed page.
    success_html = read('success-page.html')
    success_lit = js_string_literal(success_html)
    import re as _re
    final = _re.sub(
        r'const SUCCESS_PAGE_HTML = `.*?`;',
        'const SUCCESS_PAGE_HTML = `' + success_lit + '`;',
        final,
        count=1,
        flags=_re.DOTALL,
    )

    # 8b. Replace the sendDownloadEmail function body (branded sender, real domain).
    email_fn = read('send-email.js')
    final = _re.sub(
        r'async function sendDownloadEmail\(env, email\) \{.*?\n\}',
        email_fn.rstrip('\n'),
        final,
        count=1,
        flags=_re.DOTALL,
    )

    with open(out_path, 'w') as f:
        f.write(final)

    size = len(final)
    print(f"Wrote {out_path} ({size} bytes)")
    print(f"ZIP_DATA: {len(zip_b64)} chars base64")
    print("Anti-regression: success page + email sender restored from project-owned files")
    return out_path

if __name__ == '__main__':
    build()

#!/usr/bin/env python3
"""Restore the verified success-page constant after legacy build_worker regeneration.
The shared legacy template reintroduces unresolved Pixel/product placeholders.
"""
from pathlib import Path
import subprocess

root = Path('/home/salt/.hermes/mvps/coven-compass')
worker = root / 'src/worker.js'
old = subprocess.check_output(['git', 'show', 'HEAD:src/worker.js'], cwd=root, text=True)
new = worker.read_text()
start = 'const SUCCESS_PAGE_HTML = `'
end = 'export default'

def segment(text):
    a = text.index(start)
    b = text.index(end, a)
    return text[a:b]

old_segment = segment(old)
new_segment = segment(new)
assert "fbq('init', '947012561524608');" in old_segment
assert "fbq('track', 'Purchase', {value: 12.00, currency: 'USD'});" in old_segment
assert 'support@allmind.biz' in old_segment
assert '{{META_PIXEL_ID}}' in new_segment or '{{PRODUCT_PRICE}}' in new_segment
worker.write_text(new.replace(new_segment, old_segment, 1))
print('Restored verified SUCCESS_PAGE_HTML from current production baseline.')

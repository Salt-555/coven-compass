#!/bin/bash
# Deploy Coven Compass to GitHub Pages
set -e

cd "$(dirname "$0")"

echo "=== Extracting pages from worker.js ==="
python3 << 'PYEOF'
import re, sys

with open("src/worker.js") as f:
    content = f.read()

pages = {
    "landing": r"const LANDING_PAGE_HTML = `(.+?)`;",
    "app/index.html": r"const APP_HTML = `(.+?)`;",
    "success.html": r"const SUCCESS_PAGE_HTML = `(.+?)`;",
}

for name, pattern in pages.items():
    match = re.search(pattern, content, re.DOTALL)
    if match:
        with open(f"dist/{name}", "w") as f:
            f.write(match.group(1))
        print(f"✓ {name}")
    else:
        print(f"✗ Could not find page: {name}")
        sys.exit(1)

print("All pages extracted successfully!")
PYEOF

echo ""
echo "=== Committing and pushing ==="
git add -A
if git diff --cached --quiet; then
    echo "No changes to deploy."
else
    git commit -m "Deploy: update static pages ($(date +%Y-%m-%d_%H:%M))" --quiet
    git push origin main 2>&1 | tail -3
    echo ""
    echo "=== Deploy complete! ==="
    echo "Live at: https://salt-555.github.io/coven-compass/"
fi

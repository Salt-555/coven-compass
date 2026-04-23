#!/usr/bin/env python3
"""Upload the edited Coven Compass worker to Cloudflare."""
import os, json, urllib.request

CF_TOKEN = os.getenv("CLOUDFLARE_TOKEN")
ACCOUNT_ID = "52bd643c8e19504e500b44992b96e4a4"

with open(os.path.join(os.path.dirname(__file__), "src", "worker.js")) as f:
    worker_js = f.read()

metadata = {
    "main_module": "worker.js",
    "bindings": [
        {"type": "kv_namespace", "name": "SIGNUPS", "namespace_id": "719553a81859450596759c37f5727a7c"},
        {"type": "kv_namespace", "name": "CUSTOMERS", "namespace_id": "8635044516fa443c9dd502e56d7d9a22"},
        {"type": "kv_namespace", "name": "SALES", "namespace_id": "3756a16f13a54999a2d5d7e55981b6af"},
        {"type": "plain_text", "name": "BASE_URL", "text": "https://coven-compass.allmind.biz"},
    ]
}

boundary = "----UploadBoundary"
parts = [
    f"--{boundary}",
    'Content-Disposition: form-data; name="metadata"; filename="metadata.json"',
    "Content-Type: application/json",
    "",
    json.dumps(metadata),
    f"--{boundary}",
    'Content-Disposition: form-data; name="worker.js"; filename="worker.js"',
    "Content-Type: application/javascript+module",
    "",
    worker_js,
    f"--{boundary}--",
]
body = "\r\n".join(parts)

url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers/scripts/coven-compass"
req = urllib.request.Request(url, data=body.encode(), method="PUT")
req.add_header("Authorization", f"Bearer {CF_TOKEN}")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
    print(f"Success: {result.get('success')}")
    if not result.get('success'):
        print(f"Errors: {result.get('errors')}")

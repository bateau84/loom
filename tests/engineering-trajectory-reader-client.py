"""File transport for the controlled reader bridge; no fixture or scoring access.

python3 tests/engineering-trajectory-reader-client.py TRANSPORT GET /start
python3 tests/engineering-trajectory-reader-client.py TRANSPORT GET /tools/history
python3 tests/engineering-trajectory-reader-client.py TRANSPORT POST /read '{"tool":"history","input":{...}}'

The bridge counts original callback/help UTF-8 bytes. This transport envelope and
the terminal newline are not included in those callback measurements.
"""
import json
from pathlib import Path
import sys
import time
import uuid

root = Path(sys.argv[1])
method, path = sys.argv[2:4]
body = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
name = uuid.uuid4().hex + ".json"
envelope = {"method": method, "path": path, **({"body": body} if method == "POST" else {})}
temporary = root / "inbox" / (name + ".tmp")
temporary.write_text(json.dumps(envelope))
temporary.rename(root / "inbox" / name)
response_path = root / "outbox" / name
deadline = time.monotonic() + 30
while not response_path.exists():
    if time.monotonic() >= deadline:
        raise TimeoutError("Qualification bridge did not return within 30 seconds")
    time.sleep(0.05)
response = json.loads(response_path.read_text())
print(response["content"])
sys.exit(0 if response["status"] < 400 else 1)

"""Fixed stdlib synthetic persistent process tree; never product code."""
import json
import os
import time
from pathlib import Path


def main():
    if not os.environ.get("LOOM_CONTAINER_NONCE") or Path("/control/release").exists():
        raise RuntimeError("held verified fixture required")
    root = Path("/tmp/loom-custody")
    root.mkdir(mode=0o700)
    child = os.fork()
    if child == 0:
        grandchild = os.fork()
        if grandchild != 0:
            (root / "child.json").write_text(json.dumps({"child": os.getpid(), "grandchild": grandchild}))
    else:
        deadline = time.monotonic() + 2
        while not (root / "child.json").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("synthetic tree setup timeout")
            time.sleep(0.01)
        members = json.loads((root / "child.json").read_text())
        (root / "ready.json").write_text(json.dumps({"parent": os.getpid(), **members}))
    pid = os.getpid()
    count = 0
    while True:
        count += 1
        pending = root / f".{pid}.pending"
        pending.write_text(str(count))
        pending.replace(root / f"{pid}.counter")
        time.sleep(0.02)


if __name__ == "__main__":
    main()

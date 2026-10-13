"""Fixed stdlib synthetic persistent process tree; never product code."""
import json
import os
import time
from pathlib import Path


def main():
    if not os.environ.get("LOOM_CONTAINER_NONCE") or Path("/control/release").exists():
        raise RuntimeError("held verified fixture required")
    child = os.fork()
    if child == 0:
        os.fork()
    pid = os.getpid()
    count = 0
    while True:
        count += 1
        message = json.dumps({"nonce": os.environ["LOOM_CONTAINER_NONCE"], "pid": pid, "count": count}) + "\n"
        # One write below PIPE_BUF per record; three writers cannot interleave
        # a JSON record. The parent holds only the read end via its exact exec.
        os.write(1, message.encode("ascii"))
        time.sleep(0.02)


if __name__ == "__main__":
    main()

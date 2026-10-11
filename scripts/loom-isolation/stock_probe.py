"""Fixed stock V2 startup compatibility probe, ONLY after inner gate release.

No prompts, inference, provider credentials, plugin imports or service discovery.
This early falsifier is NOT native acknowledgement/physical custodian proof.
"""
import base64
import hashlib
import json
import os
import resource
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


BINARY = Path("/opt/loom-stock/bin/opencode")
EXPECTED_SHA256 = "67d8275630aa3dfe5409c6c2e1bb44ab0cf0d9558a6593e769342b9f1dc93f4b"


def limits():
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))


def checked_version(stdout: bytes) -> str:
    # Actual pinned V2 stock CLI reports this complete form, not a bare number.
    if stdout.decode("utf-8").strip() != "opencode v2.0.18":
        raise RuntimeError("stock version identity mismatch")
    return "2.0.18"


def main():
    if os.environ.get("LOOM_INNER_WORKLOAD") != "custody-stock":
        raise RuntimeError("fixed stock workload not released")
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    if (os.getuid() != 1000 or status["NoNewPrivs"].strip() != "1"
            or status["Seccomp"].strip() != "2" or int(status["Seccomp_filters"].strip()) < 2
            or any(int(status[key].strip(), 16) for key in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"))):
        raise RuntimeError("stock boundary absent")
    if hashlib.sha256(BINARY.read_bytes()).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError("stock executable pin mismatch")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("LOOM_")}
    project = Path("/tmp/loom/stock-project")
    project.mkdir(mode=0o700)
    (project / "opencode.json").write_text(json.dumps({"plugins": []}))
    version = subprocess.run([str(BINARY), "--version"], cwd=project, env=environment,
                             stdin=subprocess.DEVNULL, capture_output=True, close_fds=True, timeout=20)
    if version.returncode or len(version.stdout) + len(version.stderr) > 8192:
        raise RuntimeError("stock version invocation failed")
    reported = version.stdout.decode().strip()
    print(json.dumps({"event": "stock-version-response", "reported": reported,
                      "binarySha256": EXPECTED_SHA256, "exit": version.returncode}), flush=True)
    checked_version(version.stdout)
    print(json.dumps({"event": "stock-version-observed", "version": "2.0.18", "sha256": EXPECTED_SHA256}), flush=True)
    # Fresh synthetic transport authentication, not provider authentication.
    password = os.urandom(32).hex()
    # Pinned V2 ServerAuth fixes the username; this is not configurable through
    # OPENCODE_SERVER_USERNAME. Keep the same fresh synthetic password source.
    environment.update(OPENCODE_SERVER_PASSWORD=password)
    command = [str(BINARY), "serve", "--hostname", "127.0.0.1", "--port", "4096"]
    log = Path("/tmp/loom/stock-service.log")
    with log.open("xb") as stream:
        service = subprocess.Popen(command, cwd=project, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=stream, stderr=stream, close_fds=True, preexec_fn=limits)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            authorization = "Basic " + base64.b64encode(("opencode:" + password).encode()).decode()
            deadline = time.monotonic() + 40
            response = None
            last_transport = None
            while time.monotonic() < deadline and service.poll() is None:
                try:
                    request = urllib.request.Request("http://127.0.0.1:4096/api/info",
                                                     headers={"Authorization": authorization})
                    with opener.open(request, timeout=1) as result:
                        data = result.read(65537)
                        if len(data) > 65536:
                            raise RuntimeError("stock health body bound")
                        response = json.loads(data)
                        break
                except urllib.error.HTTPError as error:
                    # A definite HTTP rejection is not startup progress; do not
                    # vary credentials/endpoints to turn a denied call green.
                    print(json.dumps({"event": "stock-health-http-rejected", "status": error.code}), flush=True)
                    raise RuntimeError("stock health transport rejected") from error
                except (urllib.error.URLError, TimeoutError) as error:
                    cause = getattr(error, "reason", error)
                    last_transport = {"errorClass": type(cause).__name__, "errno": getattr(cause, "errno", None)}
                    time.sleep(0.1)
            if response is None:
                # Bounded source signature only. Never dump credentials/logs.
                detail = log.read_bytes()[:8192].decode(errors="replace")
                categories = [word for word in ("EPERM", "EACCES", "ENOENT", "unknown", "error") if word.lower() in detail.lower()]
                print(json.dumps({"event": "stock-startup-unproven", "exit": service.poll(),
                                  "safeSignatures": categories, "lastTransport": last_transport}), flush=True)
                raise RuntimeError("fresh stock service health unavailable")
            info = response.get("data", response)
            if not isinstance(info, dict) or info.get("pid") != service.pid:
                raise RuntimeError("stock exact foreground endpoint identity unproven")
            print(json.dumps({"event": "stock-fresh-service-observed", "namespacePid": service.pid,
                              "endpoint": "http://127.0.0.1:4096/api/info",
                              "version": "2.0.18", "freshConfig": True, "providerInference": False,
                              "actualStockCustody": "unproven"}), flush=True)
        finally:
            if service.poll() is None:
                service.terminate()
                try:
                    service.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    service.kill()
                    service.wait(timeout=3)
            # Local main exit is not descendant-empty proof. The original
            # outside exact-domain custodian still observes recursive retirement.


if __name__ == "__main__":
    main()

"""Provider-free OCI bootstrap witness. NOT the accepted bubblewrap supervisor.

Uses only a locally present eval-runner image; never imports the runner/plugin,
uses its default CLI, or inherits authentication into the container. An exact
audited command grant is required before calling this entrypoint. Pure helper
tests do not invoke Podman. Engine metadata and the fixed trusted gate are both
checked before releasing copied tests. Missing fields/restrictions fail closed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from pathlib import Path


class Refusal(RuntimeError):
    pass


PODMAN = "/usr/bin/podman"
ENGINE_INFO_FORMAT = "{{.Host.Security.Rootless}} {{.Host.CgroupsVersion}}"
ENVIRONMENT = {"HOME": "/scratch/home", "XDG_CONFIG_HOME": "/scratch/config",
               "XDG_DATA_HOME": "/scratch/data", "XDG_CACHE_HOME": "/scratch/cache",
               "XDG_STATE_HOME": "/scratch/state", "XDG_RUNTIME_DIR": "/scratch/runtime",
               "TMPDIR": "/scratch/tmp", "OPENCODE_DB": "/scratch/data/opencode.db"}


def create_command(image: str, name: str, root: Path, nonce: str) -> list[str]:
    command = [PODMAN, "create", "--name", name, "--pull", "never", "--network", "none",
               "--pid", "private", "--ipc", "private", "--cgroupns", "private",
               "--userns", "keep-id:uid=1000,gid=1000", "--user", "1000:1000",
               "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--security-opt", "label=disable", "--read-only", "--image-volume", "ignore",
               "--pids-limit", "32", "--memory", "128m", "--cpus", "1",
               "--timeout", "90", "--stop-timeout", "1", "--workdir", "/",
               "--hooks-dir", str(root / "hooks"),
               "--tmpfs", "/scratch:rw,nosuid,nodev,size=32m,mode=0700,uid=1000,gid=1000",
               "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m,mode=1777",
               "--entrypoint", "/usr/local/bin/python3"]
    for directory in ("input", "gate", "control"):
        command += ["--volume", f"{root / directory}:/{directory}:ro"]
    for key, value in ENVIRONMENT.items():
        command += ["--env", f"{key}={value}"]
    command += [image, "-I", "-S", "-B", "/gate/podman_gate.py", nonce,
                str(root / "protected" / "state")]
    return command


def engine_environment() -> dict[str, str]:
    # Host engine configuration is used only by the explicitly authorized
    # rootless engine. No remote-engine selector, auth token or env-host option.
    result = {key: os.environ[key] for key in
              ("HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME") if key in os.environ}
    result["PATH"] = "/usr/bin:/bin"
    result["LC_ALL"] = "C"
    return result


def error_class(data: bytes) -> str:
    """Fixed nonsecret error vocabulary; never return original text or paths."""
    lowered = data.lower()
    categories = (("template-field-error", (b"can't evaluate field",)),
                  ("command-option-error", (b"unknown flag", b"unknown shorthand flag")),
                  ("engine-permission-denied", (b"operation not permitted", b"permission denied")),
                  ("local-image-unavailable", (b"image not known", b"no such image")),
                  ("registry-image-unavailable", (b"manifest unknown", b"no matching manifest")),
                  ("registry-authorization", (b"unauthorized", b"authentication required")),
                  ("dependency-version-unavailable", (b"no matching version", b"etarget")),
                  ("dependency-package-unavailable", (b"unable to locate package", b"no installation candidate")),
                  ("dependency-network-dns", (b"could not resolve", b"temporary failure in name resolution")),
                  ("dependency-network-unavailable", (b"network is unreachable", b"connection refused")))
    for category, markers in categories:
        if any(marker in lowered for marker in markers):
            return category
    return "unclassified-engine-error"


def capture_command(arguments: list[str], *, timeout: float = 15) -> dict:
    """Bounded pipe capture; never persist/echo raw engine output or errors."""
    process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=engine_environment(), close_fds=True,
                               start_new_session=True)
    output = bytearray()
    errors = bytearray()
    count = 0
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            for stream in (process.stdout, process.stderr):
                if stream is None:
                    raise Refusal("engine-capture-unavailable")
                selector.register(stream, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise Refusal("engine-command-timeout")
                for key, _ in selector.select(min(0.2, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    count += len(chunk)
                    if count > 1048576:
                        raise Refusal("engine-output-limit")
                    if key.fileobj is process.stdout:
                        output.extend(chunk)
                    else:
                        errors.extend(chunk)
        status = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        return {"status": status, "stdout": bytes(output), "stderr": bytes(errors)}
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def call(arguments: list[str], *, timeout: float = 15, include_stderr: bool = False) -> bytes:
    result = capture_command(arguments, timeout=timeout)
    if result["status"] != 0:
        raise Refusal(f"engine-command-exit-{result['status']}:{error_class(result['stderr'] + result['stdout'])}")
    output = result["stdout"]
    # Opt in only for known credential-free fixture logs. Stream concatenation
    # is diagnostic, not an interleaving/order attestation.
    if include_stderr and result["stderr"]:
        output += b"\nLOOM_DIAGNOSTIC_STDERR (separate stream; order unproven)\n" + result["stderr"]
    return output


def one_record(data: bytes) -> dict:
    records = json.loads(data)
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise Refusal("engine-inspection-shape")
    return records[0]


def image_identity(record: dict) -> str:
    identity = record.get("Id", "")
    if not isinstance(identity, str):
        raise Refusal("image-identity-missing")
    identity = identity.removeprefix("sha256:")
    if len(identity) != 64 or any(char not in "0123456789abcdef" for char in identity):
        raise Refusal("image-identity-invalid")
    config = record.get("Config", {})
    if (config.get("User") != "1000:1000" or
            config.get("Entrypoint") != ["python3", "/opt/opencode-eval-runner/container/invoke.py"]):
        raise Refusal("not-the-inspected-eval-runner-image-profile")
    # Known image defaults only. Unknown inherited variables must not silently
    # become hidden credentials or interpreter startup hooks in this fixture.
    allowed = {"PATH", "LANG", "GPG_KEY", "PYTHON_VERSION", "PYTHON_SHA256", *ENVIRONMENT,
               "OPENCODE_DISABLE_AUTOUPDATE"}
    environment = config.get("Env")
    if not isinstance(environment, list) or any(
            not isinstance(item, str) or "=" not in item or item.split("=", 1)[0] not in allowed
            for item in environment):
        raise Refusal("unreviewed-image-environment")
    return "sha256:" + identity


def verify_container(record: dict, root: Path, image: str, *, running: bool) -> None:
    host = record.get("HostConfig", {})
    config = record.get("Config", {})
    state = record.get("State", {})
    actual_image = str(record.get("Image", "")).removeprefix("sha256:")
    if actual_image != image.removeprefix("sha256:"):
        raise Refusal("container-image-changed")
    if (host.get("NetworkMode") != "none" or host.get("PidMode") != "private"
            or host.get("IpcMode") != "private"
            or host.get("CgroupnsMode", host.get("CgroupMode")) != "private"
            or host.get("UsernsMode") != "private"
            or host.get("Privileged") is not False or host.get("ReadonlyRootfs") is not True
            or config.get("User") != "1000:1000"):
        raise Refusal("container-namespace-root-principal-policy")
    options = host.get("SecurityOpt", [])
    if not any(option in {"no-new-privileges", "no-new-privileges=true"} for option in options):
        raise Refusal("no-new-privileges-not-applied")
    if any("unconfined" in option for option in options):
        raise Refusal("unconfined-policy")
    expected = {f"/{name}": str(root / name) for name in ("input", "gate", "control")}
    actual = {}
    for mount in record.get("Mounts", []):
        if mount.get("Type") != "bind" or mount.get("RW") is not False:
            raise Refusal("unexpected-writable-or-nonbind-mount")
        target = mount.get("Destination")
        if target in actual:
            raise Refusal("duplicate-mount")
        actual[target] = mount.get("Source")
    if actual != expected:
        raise Refusal("mount-allowlist-mismatch")
    if running and (state.get("Running") is not True or not isinstance(state.get("Pid"), int)
                    or state["Pid"] <= 1 or not state.get("StartedAt")):
        raise Refusal("running-child-identity-unavailable")


def gate_records(data: bytes, nonce: str) -> list[dict]:
    records = []
    for line in data.splitlines():
        value = json.loads(line)
        if not isinstance(value, dict) or value.get("nonce") != nonce:
            raise Refusal("unbound-gate-output")
        records.append(value)
    if any(value.get("event") == "gate-refusal" for value in records):
        raise Refusal("trusted-gate-refused")
    return records


def prepare(root: Path) -> dict[str, str]:
    for name in ("input", "gate", "control", "protected", "hooks"):
        (root / name).mkdir(mode=0o700)
    (root / "protected" / "state").write_bytes(b"synthetic-protected-not-a-production-database\n")
    identities = {}
    sources = {"supervisor.py": "input", "test_supervisor.py": "input", "podman_gate.py": "gate"}
    for source, destination in sources.items():
        original = Path(__file__).with_name(source)
        if original.is_symlink() or not original.is_file() or original.stat().st_nlink != 1:
            raise Refusal("source-copy-not-regular-single-link")
        data = original.read_bytes()
        (root / destination / source).write_bytes(data)
        identities[source] = hashlib.sha256(data).hexdigest()
    (root / "input" / "outside-link").symlink_to(root / "protected" / "state")
    return identities


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="One local image to inspect; NEVER pulled")
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args(argv)
    name = "loom-proof-" + uuid.uuid4().hex
    nonce = uuid.uuid4().hex
    phase = "preflight"
    created = False
    cleanup = "not-created"
    payload_released = False
    result = {}
    status = 78
    try:
        if os.geteuid() == 0:
            raise Refusal("rootful-execution-forbidden")
        # No filesystem access to host proc, DB, home/state or engine stores.
        phase = "engine-capability"
        rootless = call([PODMAN, "info", "--format", ENGINE_INFO_FORMAT])
        if rootless.strip() != b"true v2":
            raise Refusal("rootless-cgroup-v2-unavailable")
        result.update(rootless=True, cgroupVersion="v2")
        phase = "local-image"
        image = image_identity(one_record(call([PODMAN, "image", "inspect", args.image])))
        result["image"] = image
        if args.inspect_only:
            result.update(event="local-image-profile-inspected", payloadReleased=False,
                          isolation="unproven", sourceImagePair="unproven")
            print(json.dumps(result, sort_keys=True))
            return 0
        with tempfile.TemporaryDirectory(prefix=".podman-witness-", dir=Path(__file__).parent) as directory:
            root = Path(directory).resolve()
            result["sources"] = prepare(root)
            phase = "create"
            # Mark before request: lost responses retain the exact unique name.
            created = True
            try:
                call(create_command(image, name, root, nonce))
                record = one_record(call([PODMAN, "inspect", name]))
                verify_container(record, root, image, running=False)
                phase = "trusted-gate"
                call([PODMAN, "start", name])
                deadline = time.monotonic() + 20
                while True:
                    records = gate_records(call([PODMAN, "logs", name]), nonce)
                    ready = [value for value in records if value.get("event") == "gate-ready"]
                    if ready:
                        break
                    if time.monotonic() >= deadline:
                        raise Refusal("gate-ready-timeout")
                    time.sleep(0.1)
                if len(ready) != 1 or ready[0].get("kernelRestricted") is not True:
                    raise Refusal("gate-attestation-unavailable")
                record = one_record(call([PODMAN, "inspect", name]))
                verify_container(record, root, image, running=True)
                # Independent engine observation and trusted pre-payload gate;
                # never a product-produced safe flag used as release authority.
                result["prePayload"] = {"container": record["Id"], "hostPid": record["State"]["Pid"],
                                        "startedAt": record["State"]["StartedAt"], "gate": ready[0]}
                rows = call([PODMAN, "top", name, "hpid", "pid"]).decode().splitlines()
                if len(rows) != 2 or rows[1].split() != [str(record["State"]["Pid"]), "1"]:
                    raise Refusal("independent-process-identity-mismatch")
                phase = "synthetic-tests"
                token = root / "control" / "release.pending"
                token.write_text(nonce)
                token.replace(root / "control" / "release")
                payload_released = True
                call([PODMAN, "wait", name], timeout=65)
                final = one_record(call([PODMAN, "inspect", name]))
                records = gate_records(call([PODMAN, "logs", name]), nonce)
                done = [value for value in records if value.get("event") == "synthetic-complete"]
                if (final.get("State", {}).get("Running") is not False
                        or final["State"].get("ExitCode") != 0 or len(done) != 1):
                    raise Refusal("synthetic-witness-incomplete")
                if (root / "protected" / "state").read_bytes() != b"synthetic-protected-not-a-production-database\n":
                    raise Refusal("synthetic-sentinel-changed")
                result["synthetic"] = done[0]
                result["event"] = "bootstrap-fixture-observed"
                status = 0
            finally:
                phase_before_cleanup = phase
                phase = "cleanup"
                call([PODMAN, "rm", "--force", name])
                cleanup = "owned-container-removed"
                phase = phase_before_cleanup
    except (Refusal, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        # Raw exceptions/engine output are not safe public diagnostic material.
        result["event"] = "bootstrap-refusal"
        result["reason"] = str(error) if isinstance(error, Refusal) else type(error).__name__
        status = 78
        if created and cleanup != "owned-container-removed":
            cleanup = "unproven-owned-container-may-remain-until-engine-timeout"
    result.update(phase=phase, payloadReleased=payload_released, cleanup=cleanup,
                  isolationTask="unproven", bubblewrapSupervisor="not-exercised",
                  providerInference=False, credentials=False)
    print(json.dumps(result, sort_keys=True))
    return status


if __name__ == "__main__":
    raise SystemExit(main())

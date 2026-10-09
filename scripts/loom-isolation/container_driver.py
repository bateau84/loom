"""Build/run Loom's credential-free Node/Bun test image; no host product imports.

Use exact command elevation for this real build/test driver. Networked build
and network-disabled tests are distinct operations. OCI transport evidence is
not completion of the separately accepted bubblewrap supervisor Task.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
import time
import uuid
from pathlib import Path, PurePosixPath

from podman_witness import ENGINE_INFO_FORMAT, PODMAN, Refusal, call, capture_command, error_class, one_record


ROOT = Path(__file__).resolve().parents[2]
OWNED = {"Containerfile.test", ".containerignore", *(
    "scripts/loom-isolation/" + name for name in
    ("container_driver.py", "container_gate.py", "test_container_driver.py",
     "podman_witness.py", "podman_gate.py", "test_podman_witness.py", "README.md"))}


def source_input(name: str) -> bool:
    path = PurePosixPath(name)
    parts = path.parts
    if not parts or path.is_absolute() or ".." in parts:
        return False
    if name in {"Containerfile.test", ".containerignore", "package.json", "bun.lock",
                "tsconfig.json", ".gitignore", "README.md"}:
        return True
    if parts[0] not in {"plugins", "scripts", "dashboard", "agents", "skills", "commands", "docs", "evals", ".github"}:
        return False
    if any((part.startswith(".") and part != ".github") or part in
           {"node_modules", "__pycache__", "ephemeral-reports"} for part in parts):
        return False
    if name.startswith(("docs/reports/", "evals/results/", "evals/artifacts/")):
        return False
    leaf = parts[-1]
    if (leaf in {"auth.json", "models.json"} or any(extension in leaf for extension in
            (".sqlite", ".db", ".log"))):
        return False
    return path.suffix in {".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".jsonc", ".md",
                           ".toml", ".yml", ".yaml", ".txt", ".sh", ".bash", ".zsh", ".css", ".html", ".svg"}


def context(destination: Path) -> dict:
    # Read-only current-worktree Git inspection, never staging/publication.
    tracked = set(call(["git", "ls-files", "-z"]).decode().split("\x00")) - {""}
    changed = set()
    for arguments in (["git", "diff", "--name-only"], ["git", "diff", "--cached", "--name-only"]):
        changed.update(call(arguments).decode().splitlines())
    if any(source_input(name) and name not in OWNED for name in changed):
        raise Refusal("unreviewed-dirty-source-input")
    names = sorted(name for name in tracked | OWNED if source_input(name) and (ROOT / name).exists())
    identities = []
    for name in names:
        original = ROOT / name
        if not stat.S_ISREG(original.lstat().st_mode) or original.stat().st_nlink != 1:
            raise Refusal("nonregular-source-input")
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        data = original.read_bytes()
        output.write_bytes(data)
        output.chmod(original.stat().st_mode & 0o777 & ~0o022)
        identities.append([name, hashlib.sha256(data).hexdigest()])
    for required in ("Containerfile.test", ".containerignore", "package.json", "bun.lock",
                     "scripts/loom-isolation/container_gate.py"):
        if not (destination / required).is_file():
            raise Refusal("missing-required-build-input")
    return {"files": len(identities), "sha256": hashlib.sha256(json.dumps(identities).encode()).hexdigest(),
            "head": call(["git", "rev-parse", "HEAD"]).decode().strip()}


def engine_ready() -> None:
    if os.geteuid() == 0:
        raise Refusal("rootful-forbidden")
    if call([PODMAN, "info", "--format", ENGINE_INFO_FORMAT]
            ).strip() != b"true v2":
        raise Refusal("rootless-cgroup-v2-required")


def build_command(root: Path, copied: Path) -> list[str]:
    command = [PODMAN, "--hooks-dir", str(root / "hooks"), "build", "--isolation", "oci", "--cap-drop", "ALL"]
    # Apt/dpkg must change file ownership and switch its download helper's UID
    # inside the rootless build namespace. This is NOT the test runtime policy.
    for capability in ("CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"):
        command += ["--cap-add", capability]
    command += ["--security-opt", "no-new-privileges", "--http-proxy=false",
                "--authfile", str(root / "empty-registry-auth.json"),
                "--iidfile", str(root / "image-id"),
                "--ignorefile", str(copied / ".containerignore"),
                "--file", str(copied / "Containerfile.test"), str(copied)]
    return command


def events(logs: bytes, nonce: str) -> list[dict]:
    result = []
    for line in logs.splitlines():
        if line.startswith(b"LOOM_CONTAINER_EVENT "):
            value = json.loads(line.removeprefix(b"LOOM_CONTAINER_EVENT "))
            if value.get("nonce") != nonce:
                raise Refusal("unbound-gate-event")
            result.append(value)
    if any(value.get("event") == "refusal" for value in result):
        # This fixture has no credential inputs, no provider network and no
        # production mounts. Retain both bounded diagnostic streams on failure,
        # without presenting their concatenation as exact event ordering.
        print(logs.decode(errors="replace"), end="", flush=True)
        raise Refusal("trusted-gate-refused-completion-unproven")
    return result


def validate_probes(probes: list[dict], phase: str) -> None:
    required = {(kind, operation) for kind in ("direct", "link", "ambient") for operation in ("read", "write")}
    if len(probes) != 6 or {(item.get("kind"), item.get("operation")) for item in probes} != required:
        raise Refusal("synthetic-probe-coverage")
    for item in probes:
        if (item.get("phase") != phase or item.get("errno") not in {2, 1, 13, 20}
                or (item["kind"] == "ambient" and item.get("ambientMisdirected") is not True)):
            raise Refusal("synthetic-probe-denial-or-ambient-contrast")


def validate(record: dict, image: str, root: Path, *, running: bool) -> None:
    host, config, state = record.get("HostConfig", {}), record.get("Config", {}), record.get("State", {})
    if (str(record.get("Image", "")).removeprefix("sha256:") != image.removeprefix("sha256:")
            or config.get("User") not in {"node", "1000", "1000:1000"}
            or host.get("Privileged") is not False or host.get("NetworkMode") != "none"
            or host.get("PidMode") != "private" or host.get("IpcMode") != "private"
            or host.get("CgroupnsMode", host.get("CgroupMode")) != "private"
            # Podman 5.8.4 container_inspect_linux.go reports the OCI user
            # namespace as private; keep-id is a CLI mapping selector, not this field.
            or host.get("UsernsMode") != "private"):
        raise Refusal("engine-namespace-principal-policy")
    options = host.get("SecurityOpt", [])
    if (not any(value in {"no-new-privileges", "no-new-privileges=true"} for value in options)
            or any("unconfined" in value for value in options)):
        raise Refusal("engine-security-policy")
    binds = {}
    for mount in record.get("Mounts", []):
        if mount.get("Type") == "tmpfs" and mount.get("Destination") == "/tmp":
            continue
        if mount.get("Type") != "bind" or mount.get("RW") is not False:
            raise Refusal("unexpected-host-or-writable-mount")
        target = mount.get("Destination")
        if target in binds:
            raise Refusal("duplicate-bind")
        binds[target] = mount.get("Source")
    if binds != {"/control": str(root / "control"), "/probes": str(root / "probes")}:
        raise Refusal("host-mount-allowlist")
    if running and (state.get("Running") is not True or state.get("Pid", 0) <= 1 or not state.get("StartedAt")):
        raise Refusal("running-container-identity")


def run_tests(image: str) -> int:
    if not image.startswith("sha256:") or len(image) != 71 or any(c not in "0123456789abcdef" for c in image[7:]):
        raise Refusal("run-requires-content-addressed-image")
    nonce = uuid.uuid4().hex
    name = "loom-tests-" + nonce
    diagnostic = {"schema": "loom-container-test-diagnostic/v1", "runId": nonce,
                  "image": image, "containerName": name, "command": "bun run test",
                  "credentialInputs": False, "providerInference": False,
                  "streamOrder": "unproven", "preImportObserved": False,
                  "streamsAvailable": False, "loss": "not-captured", "cleanup": "unproven"}
    with tempfile.TemporaryDirectory(prefix=".container-run-", dir=Path(__file__).parent) as directory:
        root = Path(directory).resolve()
        for part in ("control", "probes", "protected", "hooks"):
            (root / part).mkdir(mode=0o700)
        sentinel = root / "protected" / "state"
        sentinel.write_bytes(b"outer-synthetic-sentinel")
        (root / "probes" / "outside").symlink_to(sentinel)
        command = [PODMAN, "create", "--name", name, "--pull", "never", "--network", "none",
                   "--pid", "private", "--ipc", "private", "--cgroupns", "private",
                   "--userns", "keep-id:uid=1000,gid=1000", "--user", "1000:1000",
                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                   "--security-opt", "label=disable", "--image-volume", "ignore",
                   "--pids-limit", "512", "--memory", "2g", "--cpus", "2",
                   "--timeout", "1800", "--stop-timeout", "2", "--hooks-dir", str(root / "hooks"),
                   "--tmpfs", "/tmp:rw,nosuid,nodev,size=1g,mode=1777",
                   "--volume", f"{root / 'control'}:/control:ro",
                   "--volume", f"{root / 'probes'}:/probes:ro",
                   "--env", f"LOOM_CONTAINER_NONCE={nonce}",
                   "--env", f"LOOM_CONTAINER_SENTINEL={sentinel}", image, "bun", "run", "test"]
        try:
            call(command)
            validate(one_record(call([PODMAN, "inspect", name])), image, root, running=False)
            call([PODMAN, "start", name])
            deadline = time.monotonic() + 30
            while True:
                ready = [event for event in events(call([PODMAN, "logs", name], include_stderr=True), nonce) if event["event"] == "ready"]
                if ready:
                    break
                if time.monotonic() > deadline:
                    raise Refusal("preimport-gate-timeout")
                time.sleep(0.1)
            if len(ready) != 1 or ready[0].get("restricted") is not True:
                raise Refusal("kernel-attestation-incomplete")
            validate_probes(ready[0].get("beforeImportDenials", []), "before-import")
            record = one_record(call([PODMAN, "inspect", name]))
            validate(record, image, root, running=True)
            rows = call([PODMAN, "top", name, "hpid", "pid"]).decode().splitlines()
            if len(rows) != 2 or rows[1].split() != [str(record["State"]["Pid"]), "1"]:
                raise Refusal("independent-process-identity")
            diagnostic.update(preImportObserved=True, containerId=record["Id"],
                              hostPid=record["State"]["Pid"], startedAt=record["State"]["StartedAt"],
                              preImportGate=ready[0])
            print(json.dumps({"event": "preimport-engine-and-gate-observed", "image": image,
                              "container": record["Id"], "hostPid": record["State"]["Pid"],
                              "startedAt": record["State"]["StartedAt"], "gate": ready[0]}), flush=True)
            (root / "control" / "release").write_text(nonce)
            call([PODMAN, "wait", name], timeout=1805)
            captured = capture_command([PODMAN, "logs", name])
            if captured["status"] != 0:
                diagnostic["loss"] = "engine-log-command-failed"
                raise Refusal("engine-log-command-failed:" + error_class(captured["stderr"]))
            strings = {}
            decoding_loss = False
            for stream in ("stdout", "stderr"):
                try:
                    strings[stream] = captured[stream].decode("utf-8")
                except UnicodeDecodeError:
                    strings[stream] = captured[stream].decode("utf-8", errors="replace")
                    decoding_loss = True
            diagnostic.update(streamsAvailable=True, streams=strings, byteLimit=1048576,
                              bytes={stream: len(captured[stream]) for stream in ("stdout", "stderr")},
                              loss="utf8-replacement" if decoding_loss else "none")
            logs = captured["stdout"] + b"\nLOOM_DIAGNOSTIC_STDERR (separate stream; order unproven)\n" + captured["stderr"]
            done = [event for event in events(logs, nonce) if event["event"] == "done"]
            descendants = [event for event in events(logs, nonce) if event["event"] == "descendant"]
            final = one_record(call([PODMAN, "inspect", name]))
            if len(done) != 1 or final["State"]["Running"] is not False or sentinel.read_bytes() != b"outer-synthetic-sentinel":
                raise Refusal("test-result-or-sentinel-observation-incomplete")
            if len(descendants) != 1:
                raise Refusal("descendant-witness-missing")
            validate_probes(done[0].get("setupDenials", []), "setup")
            validate_probes(descendants[0].get("denials", []), "descendant")
            diagnostic["descendantGate"] = descendants[0]
            status = done[0]["testExit"]
            if final["State"]["ExitCode"] != status:
                raise Refusal("gate-engine-exit-disagreement")
            diagnostic.update(testExit=status, engineExit=final["State"]["ExitCode"],
                              sentinelUnchanged=True, gateDone=done[0])
            # Source/fixtures only, no real credentials were ever admitted.
            sys_output = logs.decode(errors="replace")
            print(sys_output, end="", flush=True)
            print(json.dumps({"event": "container-test-result", "exit": status,
                              "syntheticSentinelUnchanged": True, "image": image,
                              "fullBubblewrapTask": "unproven"}), flush=True)
            return status
        except Refusal as error:
            diagnostic["operationError"] = str(error)
            if str(error) == "engine-output-limit":
                diagnostic["loss"] = "output-limit"
            elif str(error) == "engine-command-timeout":
                diagnostic["loss"] = "capture-timeout"
            raise
        finally:
            try:
                call([PODMAN, "rm", "--force", name])
                diagnostic["cleanup"] = "owned-container-removed"
            finally:
                save_diagnostic(diagnostic)


def save_diagnostic(record: dict) -> None:
    # Genuinely new provider-free run output, never a copy/read of denied old
    # managed shell artifacts. Hidden result paths are excluded from contexts.
    directory = Path(__file__).parent / ".container-results"
    if directory.is_symlink():
        raise Refusal("diagnostic-directory-is-symlink")
    directory.mkdir(mode=0o700, exist_ok=True)
    stream_files = {}
    for kind, text in record.pop("streams", {}).items():
        data = text.encode("utf-8")
        stream_path = directory / (record["runId"] + "." + kind + ".log")
        stream_fd = os.open(stream_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(stream_fd, "wb") as stream:
            stream.write(data)
        stream_files[kind] = {"file": stream_path.name, "sha256": hashlib.sha256(data).hexdigest(),
                              "bytes": len(data), "representation": "utf8-diagnostic"}
    record["streamFiles"] = stream_files
    path = directory / (record["runId"] + ".json")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"event": "scoped-diagnostic-written", "path": str(path.relative_to(ROOT)),
                      "runId": record["runId"], "loss": record["loss"], "cleanup": record["cleanup"]}), flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("build", "run"))
    parser.add_argument("--image")
    args = parser.parse_args(argv)
    phase = "engine-preflight"
    try:
        if Path.cwd().resolve() != ROOT:
            raise Refusal("run-driver-from-repository-root")
        engine_ready()
        print(json.dumps({"event": "rootless-engine-observed", "rootless": True, "cgroupVersion": "v2"}), flush=True)
        if args.operation == "run":
            if not args.image:
                raise Refusal("run-needs-image-id-from-build")
            phase = "gated-test"
            return run_tests(args.image)
        phase = "source-context"
        with tempfile.TemporaryDirectory(prefix=".container-build-", dir=Path(__file__).parent) as directory:
            root = Path(directory).resolve()
            copied = root / "context"
            copied.mkdir()
            (root / "hooks").mkdir()
            identity = context(copied)
            auth = root / "empty-registry-auth.json"
            auth.write_text('{"auths":{}}')
            auth.chmod(0o600)
            phase = "isolated-image-build"
            iid = root / "image-id"
            command = build_command(root, copied)
            logs = call(command, timeout=1800)
            image = iid.read_text().strip()
            record = one_record(call([PODMAN, "image", "inspect", image]))
            if str(record["Id"]).removeprefix("sha256:") != image.removeprefix("sha256:"):
                raise Refusal("built-image-identity-mismatch")
            print(logs.decode(errors="replace"), end="")
            print(json.dumps({"event": "test-image-built", "image": image, "source": identity,
                              "bun": "1.4.2", "runtimeTests": "not-run"}), flush=True)
        return 0
    except (Refusal, OSError, ValueError, KeyError) as error:
        print(json.dumps({"event": "container-operation-refused", "phase": phase,
                          "reason": str(error) if isinstance(error, Refusal) else type(error).__name__,
                          "fullBubblewrapTask": "unproven"}), flush=True)
        return 78


if __name__ == "__main__":
    raise SystemExit(main())

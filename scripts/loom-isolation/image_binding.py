"""Inspectable selected-input and actual stopped-image binding; no code execution.

Receipts are ordinary producer evidence for a known reviewed image, NOT signed
authority or an arbitrary-image sandbox. No product imports occur in this module.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import uuid
from pathlib import Path, PurePosixPath

from podman_witness import PODMAN, Refusal, call, one_record


SOURCE_LABEL = "io.loom.tests.inputs"
GATE_LABEL = "io.loom.tests.gate"
GATE_INPUT = "scripts/loom-isolation/container_gate.py"
GATE_IMAGE = "/opt/loom-test-gate.py"
ENTRYPOINT = ["python3", "-I", "-S", "-B", GATE_IMAGE]
COMMAND = ["bun", "run", "test"]
REQUIRED_ENV = {"PYTHONPATH": "/opt/loom-test-deps/eval-runner", "HOME": "/tmp/loom/home",
                **{"XDG_" + kind + "_HOME": "/tmp/loom/" + kind.lower()
                   for kind in ("CONFIG", "DATA", "STATE", "CACHE")},
                "XDG_RUNTIME_DIR": "/tmp/loom/runtime", "TMPDIR": "/tmp/loom/tmp",
                "OPENCODE_DB": "/tmp/loom/data/opencode.db", "OPENCODE_DISABLE_AUTOUPDATE": "1"}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def image_id(value: str) -> str:
    value = value.removeprefix("sha256:")
    if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
        raise Refusal("invalid-image-id")
    return "sha256:" + value


def regular_path(root: Path, name: str) -> Path:
    if root.is_symlink():
        raise Refusal("manifest-root-is-symlink")
    relative = PurePosixPath(name)
    if (not name or relative.is_absolute() or str(relative) != name or ".." in relative.parts):
        raise Refusal("invalid-manifest-path")
    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            raise Refusal("manifest-symlink-input")
    if not stat.S_ISREG(path.stat().st_mode):
        raise Refusal("manifest-nonregular-input")
    return path


def file_entries(root: Path, names: list[str]) -> list[dict]:
    if len(names) != len(set(names)):
        raise Refusal("duplicate-manifest-path")
    entries = []
    for name in sorted(names):
        path = regular_path(root, name)
        data = path.read_bytes()
        entries.append({"path": name, "sha256": hashlib.sha256(data).hexdigest(),
                        "size": len(data), "mode": stat.S_IMODE(path.stat().st_mode)})
    return entries


def verify_files(root: Path, entries: list[dict]) -> dict:
    actual = file_entries(root, [entry["path"] for entry in entries])
    if actual != sorted(entries, key=lambda entry: entry["path"]):
        raise Refusal("selected-input-bytes-or-modes-changed")
    return {"files": len(actual), "sha256": digest(actual), "allMatched": True}


def configuration(record: dict) -> dict:
    config = record.get("Config", {})
    if (config.get("Entrypoint") != ENTRYPOINT or config.get("Cmd") != COMMAND
            or config.get("WorkingDir") != "/workspace" or config.get("User") != "node"):
        raise Refusal("image-entrypoint-command-workdir-principal")
    environment = {}
    for value in config.get("Env", []):
        if not isinstance(value, str) or "=" not in value:
            raise Refusal("image-environment-shape")
        key, value = value.split("=", 1)
        if key not in {*REQUIRED_ENV, "PATH", "NODE_VERSION", "YARN_VERSION"} or key in environment:
            raise Refusal("image-environment-unreviewed-field")
        environment[key] = value
    if any(environment.get(key) != value for key, value in REQUIRED_ENV.items()):
        raise Refusal("image-private-state-environment")
    return {"entrypoint": config["Entrypoint"], "command": config["Cmd"],
            "workingDir": config["WorkingDir"], "user": config["User"],
            "environment": environment}


def verify_configuration(record: dict, receipt: dict) -> None:
    if image_id(record["Id"]) != receipt["image"] or configuration(record) != receipt["imageConfiguration"]:
        raise Refusal("receipt-image-configuration-mismatch")
    labels = record.get("Config", {}).get("Labels", {}) or {}
    if (labels.get(SOURCE_LABEL) != receipt["source"]["sha256"]
            or labels.get(GATE_LABEL) != receipt["gateSha256"]):
        raise Refusal("receipt-image-label-mismatch")


def inspect_files(container: str, root: Path, source: dict, expected_gate: str) -> dict:
    """Copy selected source roots from a stopped container; never start its code.

    node_modules and unrelated image paths are not exported. Every selected file
    is compared to the full input manifest, including mode/size/content digest.
    """
    record = one_record(call([PODMAN, "inspect", container]))
    if record.get("State", {}).get("Running") is not False or record["State"].get("Pid", 0) != 0:
        raise Refusal("image-files-require-stopped-container")
    destination = root / "image-inputs"
    destination.mkdir(mode=0o700)
    for top in sorted({entry["path"].split("/", 1)[0] for entry in source["entries"]}):
        call([PODMAN, "cp", container + ":/workspace/" + top, str(destination / top)], timeout=60)
    matched = verify_files(destination, source["entries"])
    gate_path = root / "image-gate.py"
    call([PODMAN, "cp", container + ":" + GATE_IMAGE, str(gate_path)])
    gate = regular_path(root, "image-gate.py").read_bytes()
    actual_gate = hashlib.sha256(gate).hexdigest()
    if actual_gate != expected_gate:
        raise Refusal("actual-image-gate-bytes-mismatch")
    return {"inspection": "stopped-container-copy-no-execution", "containerId": record["Id"],
            "selectedInputs": matched, "gateSha256": actual_gate}


def atomic_json(path: Path, value: dict) -> None:
    pending = path.with_name("." + path.name + "-" + uuid.uuid4().hex + ".pending")
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, sort_keys=True, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        pending.replace(path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        pending.unlink(missing_ok=True)


def load_receipt(path: Path, artifact_root: Path) -> tuple[dict, str]:
    # No external read workaround: only the current admitted build-artifact tree.
    absolute = path.absolute()
    try:
        relative = absolute.relative_to(artifact_root.absolute())
    except ValueError as error:
        raise Refusal("receipt-outside-build-artifact-scope") from error
    with regular_path(artifact_root, relative.as_posix()).open("rb") as stream:
        data = stream.read(1048577)
    if len(data) > 1048576:
        raise Refusal("receipt-size-limit")
    try:
        receipt = json.loads(data)
        entries = receipt["source"]["entries"]
        names = [entry["path"] for entry in entries]
        gate = [entry for entry in entries if entry["path"] == GATE_INPUT]
        if (receipt.get("schema") != "loom-test-image-build/v1" or receipt.get("status") != "verified"
                or image_id(receipt["image"]) != receipt["image"]
                or digest(entries) != receipt["source"]["sha256"] or len(names) != len(set(names))
                or len(gate) != 1 or receipt["gateSha256"] != gate[0]["sha256"]):
            raise Refusal("build-receipt-invalid-or-unverified")
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise Refusal("build-receipt-invalid-or-unverified") from error
    return receipt, hashlib.sha256(data).hexdigest()

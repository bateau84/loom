"""Standalone isolation preflight. This checkpoint DOES NOT launch a payload.

Only stdlib and this component are loaded. Host capability observation and the
gated bubblewrap launch require separate native admission; a launch plan is not
an attestation. Never wire this checkpoint into a product runner as protection.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


class Refusal(ValueError):
    """An unmet prerequisite, not a product execution failure or isolation PASS."""


@dataclass(frozen=True)
class Manifest:
    custody: str
    bubblewrap: str
    bubblewrap_digest: str
    bubblewrap_version: str
    image: str
    files: tuple[tuple[str, str], ...]
    policy_digest: str


def _absolute_path(value: object, field: str) -> str:
    # Lexical only: no resolve/stat/open of externally supplied host paths.
    if not isinstance(value, str) or not value.startswith("/"):
        raise Refusal(f"{field}: require an explicitly admitted absolute path")
    if value == "/" or value.startswith("//") or "\x00" in value or "\n" in value:
        raise Refusal(f"{field}: root/control-character path is forbidden")
    if str(PurePosixPath(value)) != value or ".." in value.split("/"):
        raise Refusal(f"{field}: require canonical lexical path")
    return value


def _digest(value: object, field: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise Refusal(f"{field}: require an approved SHA-256 identity")
    return value


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise Refusal(f"manifest: duplicate field {key}")
        result[key] = value
    return result


def load_manifest(path: Path) -> Manifest:
    """Read only the exact manifest. No substrate, image, proc or cgroup access.

    Approval/digests are inputs, not facts established by this parser. In
    particular the cgroup path must be an allocated empty delegated leaf, never
    discovered by scanning host state or created by a product process.
    """
    try:
        with path.open("rb") as stream:
            data = stream.read(262145)
        if len(data) > 262144:
            raise Refusal("manifest: exceeds 256 KiB")
        raw = json.loads(data, object_pairs_hook=_unique_object)
    except (OSError, ValueError) as error:
        raise Refusal(f"manifest: {error}") from error
    if not isinstance(raw, dict):
        raise Refusal("manifest: require an object")
    if not raw.get("custody"):
        raise Refusal("custody: no explicitly admitted delegated cgroup-v2 leaf")
    expected = {"format", "syntheticOnly", "custody", "bubblewrap", "image", "policySha256"}
    if (set(raw) != expected or type(raw["format"]) is not int or raw["format"] != 1
            or raw["syntheticOnly"] is not True):
        raise Refusal("manifest: unsupported fields/format or non-synthetic input")
    custody = _absolute_path(raw["custody"], "custody")
    bwrap = raw["bubblewrap"]
    image = raw["image"]
    if not isinstance(bwrap, dict) or set(bwrap) != {"path", "sha256", "version"}:
        raise Refusal("bubblewrap: require exact executable/version/digest approval")
    if bwrap["version"] != "0.12.0":
        raise Refusal("bubblewrap: this policy targets 0.12.0; no version fallback")
    if not isinstance(image, dict) or set(image) != {"path", "files"}:
        raise Refusal("image: require finite approved copied source/toolchain inventory")
    if not isinstance(image["files"], dict) or not image["files"]:
        raise Refusal("image: require nonempty finite file inventory")
    files = []
    for name, digest in sorted(image["files"].items()):
        if not isinstance(name, str):
            raise Refusal("image: file name is not text")
        parts = name.split("/")
        if (len(parts) < 2 or parts[0] not in {"usr", "lib", "lib64", "source", "gate"}
                or any(part in {"", ".", "..", ".git"} for part in parts)
                or "\x00" in name or "\n" in name):
            raise Refusal("image: escaping/non-allowlisted/shared-Git input")
        files.append((name, _digest(digest, f"image:{name}")))
    required = {"usr/bin/python3", "gate/gate.py"}
    if not required.issubset(dict(files)):
        raise Refusal("image: missing copied interpreter or trusted pre-payload gate")
    return Manifest(custody, _absolute_path(bwrap["path"], "bubblewrap.path"),
                    _digest(bwrap["sha256"], "bubblewrap.sha256"), bwrap["version"],
                    _absolute_path(image["path"], "image.path"), tuple(files),
                    _digest(raw["policySha256"], "policySha256"))


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        load_manifest(arguments.manifest)
        # Deliberately no executable launch API in this source-only checkpoint.
        # Valid configuration cannot masquerade as independently observed proof.
        raise Refusal("host-observation: native admission and applied-boundary proof still required")
    except Refusal as error:
        print(json.dumps({"event": "prelaunch-refusal", "payloadStarted": False,
                          "isolation": "unproven", "reason": str(error)}, sort_keys=True))
        return 78


if __name__ == "__main__":
    raise SystemExit(main())

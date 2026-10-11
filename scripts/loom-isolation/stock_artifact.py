"""Pinned stock V2 dependency acquisition during image build, never execution.

No npm lifecycle script, ambient proxy/config, host installation or product
imports. The native package is the finite executable closure; libc/toolchain
dependencies remain in the existing pinned Node/Debian image. A stopped-image
inspection rechecks this manifest and binary before any stock runtime release.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import stat
import tarfile
import urllib.request
from pathlib import Path


VERSION = "2.0.18"
PACKAGE = "@opencode/cli-linux-x64-baseline"
URL = "https://registry.npmjs.org/@opencode/cli-linux-x64-baseline/-/cli-linux-x64-baseline-2.0.18.tgz"
INTEGRITY = "sha512-yR7tA8ZAjUzUV3vcBIV1z/zp7KPNV55XQipP9qsQppEApyEv7/NJOIaPK8n+yFl7kogPRk1fQ0fsOW+4KO7mbQ=="
MAX_COMPRESSED = 128 * 1024 * 1024
MAX_UNPACKED = 203_146_965
IMAGE_ROOT = Path("/opt/loom-stock")
SCHEMA = "loom-stock-artifact/v1"


class ArtifactRefusal(Exception):
    pass


def archive_contents(data: bytes) -> bytes:
    """Parse only the two regular package files; never call extract/extractall."""
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        files = {}
        total = 0
        for member in archive:
            if member.isdir() and member.name.rstrip("/") in {"package", "package/bin"}:
                continue
            if (not member.isfile() or member.name not in
                    {"package/package.json", "package/bin/opencode", "package/bin/opencode.exe"}
                    or member.name in files or member.size <= 0):
                raise ArtifactRefusal("stock-archive-entry")
            total += member.size
            if total > MAX_UNPACKED:
                raise ArtifactRefusal("stock-archive-size")
            stream = archive.extractfile(member)
            if stream is None:
                raise ArtifactRefusal("stock-archive-file")
            with stream:
                value = stream.read(member.size + 1)
            if len(value) != member.size:
                raise ArtifactRefusal("stock-archive-truncated")
            files[member.name] = value
    binaries = [name for name in files if name.startswith("package/bin/")]
    if len(files) != 2 or len(binaries) != 1 or "package/package.json" not in files:
        raise ArtifactRefusal("stock-archive-closure")
    metadata = json.loads(files["package/package.json"])
    if (metadata.get("name") != PACKAGE or metadata.get("version") != VERSION
            or metadata.get("dependencies") or metadata.get("optionalDependencies")
            or metadata.get("scripts")):
        raise ArtifactRefusal("stock-package-identity-or-extra-dependency")
    executable = files[binaries[0]]
    if executable[:4] != b"\x7fELF":
        raise ArtifactRefusal("stock-native-elf-required")
    return executable


def verified_contents(data: bytes) -> bytes:
    actual = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
    if len(data) > MAX_COMPRESSED or actual != INTEGRITY:
        raise ArtifactRefusal("stock-pinned-integrity")
    return archive_contents(data)


def manifest(executable: bytes) -> dict:
    return {"schema": SCHEMA, "package": PACKAGE, "version": VERSION,
            "archiveUrl": URL, "archiveIntegrity": INTEGRITY,
            "binary": {"path": "bin/opencode", "sha256": hashlib.sha256(executable).hexdigest(),
                       "size": len(executable), "mode": 0o555},
            "execution": "not-executed", "dependencyClosure": "native-package-plus-pinned-image"}


def inspect(root: Path) -> dict:
    """Read copied-out stopped-image artifact. No command or network execution."""
    for relative in ("manifest.json", "bin", "bin/opencode"):
        path = root / relative
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or (relative != "bin" and
                (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)):
            raise ArtifactRefusal("stock-image-nonregular-artifact")
    binary = root / "bin/opencode"
    if binary.stat().st_size > MAX_UNPACKED or stat.S_IMODE(binary.stat().st_mode) != 0o555:
        raise ArtifactRefusal("stock-image-binary-size-or-mode")
    metadata = root / "manifest.json"
    if metadata.stat().st_size > 8192:
        raise ArtifactRefusal("stock-image-manifest-size")
    executable = binary.read_bytes()
    actual = manifest(executable)
    if json.loads(metadata.read_bytes()) != actual or executable[:4] != b"\x7fELF":
        raise ArtifactRefusal("stock-image-manifest-or-bytes")
    return actual


def main():
    # Exact image-contained build purpose, not a general download/install API.
    if os.uname().machine != "x86_64" or IMAGE_ROOT.exists():
        raise ArtifactRefusal("stock-build-target-or-existing-root")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(URL, timeout=60) as response:
        if response.geturl() != URL:
            raise ArtifactRefusal("stock-unreviewed-redirect")
        data = response.read(MAX_COMPRESSED + 1)
    executable = verified_contents(data)
    (IMAGE_ROOT / "bin").mkdir(parents=True, mode=0o755)
    binary = IMAGE_ROOT / "bin/opencode"
    binary.write_bytes(executable)
    binary.chmod(0o555)
    output = manifest(executable)
    (IMAGE_ROOT / "manifest.json").write_text(json.dumps(output, sort_keys=True, indent=2) + "\n")
    (IMAGE_ROOT / "manifest.json").chmod(0o444)
    print(json.dumps({"event": "stock-artifact-acquired-not-executed", **output}, sort_keys=True))


if __name__ == "__main__":
    main()

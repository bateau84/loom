"""Source-only OCI adapter core; no executable engine protocol is ready yet.

Accepted contract: docs/architecture/loom/specs/oci-test-adapter.md.
Architect OQ b17071dc permits this partial fail-closed checkpoint. Missing
engine/store descriptors are deliberately unavailable, not guessed defaults.
No host test/plugin/config imports, engine discovery, or subprocesses occur here.
Do not execute even these pure tests until source/effect review and admission.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
from pathlib import Path, PurePosixPath


IMAGE_ID = "6f4f933b7e6327a090c49b968a75c31a9a717415f81b207dcfda3329d5e40da4"
SELECTIONS = ("isolation", "native", "canonical", "static", "all")
# Not a runtime/caller-selected registry. Final reviewed constants must describe
# exact version, compatible existing image store/state, helpers/config and effects.
ENGINE_READINESS = None
SOURCE_ROOTS = ("plugins/loom", "scripts", "dashboard")
ROOT_FILES = ("package.json", "package-lock.json", "bun.lock", "bun.lockb", "tsconfig.json")
FORBIDDEN_PARTS = frozenset({
    ".git", ".hg", ".svn", ".loom", ".npmrc", ".env", "ephemeral-reports",
    "runtime-root.json", "execution-state.sqlite", "opencode.json", "opencode.jsonc",
})


class AdapterError(RuntimeError):
    """The adapter cannot establish a complete, source-relevant safe result."""


def parse_selection(argv: list[str]) -> str:
    if len(argv) != 2 or argv[0] != "--suite" or argv[1] not in SELECTIONS:
        raise AdapterError("Expected exactly --suite isolation|native|canonical|static|all")
    return argv[1]


def require_engine_readiness() -> None:
    # Intentionally unconditional until concrete descriptors/configuration and
    # their provenance are implemented and assessed. A patched non-None sentinel
    # cannot accidentally unlock an unfinished engine protocol.
    raise AdapterError("engine readiness unavailable: version/store/state/config compatibility unresolved")


def _relative(value: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise AdapterError("Invalid project-relative input")
    path = PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix() or any(part in (".", "..") for part in value.split("/")):
        raise AdapterError("Noncanonical or escaping input: " + value)
    if any(part in FORBIDDEN_PARTS or part.startswith(".env.") or
           part.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm")) for part in path.parts):
        raise AdapterError("Excluded input: " + value)
    return path


def _validate_roots(roots: list[str]) -> None:
    if (not isinstance(roots, list) or not roots or
            any(not isinstance(value, str) for value in roots) or roots != sorted(set(roots))):
        raise AdapterError("Input roots must be nonempty, sorted and unique")
    for value in roots:
        path = _relative(value)
        # Dependencies must name concrete installed packages, not the whole
        # dependency directory or an arbitrary external path. All contained links
        # are still rejected; no dependency dereference fallback is provided.
        dependency = (len(path.parts) >= 2 and path.parts[0] == "node_modules" and
                      (not path.parts[1].startswith("@") or len(path.parts) >= 3))
        if not (value in ROOT_FILES or dependency or any(
            value == root or value.startswith(root + "/") for root in SOURCE_ROOTS
        )):
            raise AdapterError("Unapproved input root: " + value)
        if any(value.startswith(other + "/") for other in roots if other != value):
            raise AdapterError("Overlapping input roots: " + value)


def _fingerprint(info: os.stat_result) -> tuple:
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _scan(root: Path, roots: list[str], destination: Path | None = None) -> dict:
    """Read through no-follow directory/file descriptors; hash actual copied bytes.

    The destination, when supplied, is an already checked fresh owned private
    tree. Callers retain ownership of its cleanup even on failure. This routine
    never removes existing paths or modifies the source.
    """
    _validate_roots(roots)
    files: list[list] = []
    empty: list[str] = []
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def visit(parent_fd: int, name: str, relative: str) -> None:
        _relative(relative)
        before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if stat.S_ISDIR(before.st_mode):
            fd = os.open(name, directory_flags, dir_fd=parent_fd)
            try:
                if _fingerprint(os.fstat(fd)) != _fingerprint(before):
                    raise AdapterError("Directory changed before open: " + relative)
                names = sorted(os.listdir(fd))
                if not names:
                    empty.append(relative)
                if destination is not None:
                    (destination / relative).mkdir(parents=True, mode=0o700, exist_ok=True)
                for child in names:
                    visit(fd, child, relative + "/" + child)
                if names != sorted(os.listdir(fd)) or _fingerprint(os.fstat(fd)) != _fingerprint(before):
                    raise AdapterError("Directory changed during snapshot: " + relative)
            finally:
                os.close(fd)
        elif stat.S_ISREG(before.st_mode) and before.st_nlink == 1:
            if before.st_mode & (stat.S_ISUID | stat.S_ISGID):
                raise AdapterError("Privileged input mode: " + relative)
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
            output = None
            try:
                if _fingerprint(os.fstat(fd)) != _fingerprint(before):
                    raise AdapterError("File changed before open: " + relative)
                executable = bool(before.st_mode & 0o111)
                if destination is not None:
                    target = destination / relative
                    target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                    output = target.open("xb")
                digest = hashlib.sha256()
                length = 0
                while chunk := os.read(fd, 1024 * 1024):
                    length += len(chunk)
                    digest.update(chunk)
                    if output is not None:
                        output.write(chunk)
                if length != before.st_size or _fingerprint(os.fstat(fd)) != _fingerprint(before):
                    raise AdapterError("File changed during snapshot: " + relative)
                if output is not None:
                    output.flush()
                    os.fchmod(output.fileno(), 0o755 if executable else 0o644)
                files.append([relative, "executable" if executable else "regular", length, digest.hexdigest()])
            finally:
                if output is not None:
                    output.close()
                os.close(fd)
        else:
            raise AdapterError("Input is a link, hardlink or special file: " + relative)
        after = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if _fingerprint(before) != _fingerprint(after):
            raise AdapterError("Input changed during snapshot: " + relative)

    try:
        root_fd = os.open(root, directory_flags)
        try:
            for value in roots:
                parts = _relative(value).parts
                parent_fd = os.dup(root_fd)
                try:
                    for part in parts[:-1]:
                        next_fd = os.open(part, directory_flags, dir_fd=parent_fd)
                        os.close(parent_fd)
                        parent_fd = next_fd
                    visit(parent_fd, parts[-1], value)
                finally:
                    os.close(parent_fd)
        finally:
            os.close(root_fd)
    except OSError as error:
        raise AdapterError("Input snapshot failed: " + str(error)) from error
    files.sort(key=lambda item: item[0])
    if not files:
        raise AdapterError("No regular input files selected")
    canonical = json.dumps(files, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {"inputDigest": hashlib.sha256(canonical).hexdigest(),
            "fileTupleCount": len(files), "files": files, "emptyDirectories": sorted(empty)}


def inspect_inputs(root: Path, roots: list[str]) -> dict:
    return _scan(root, roots)


def recheck_source(root: Path, roots: list[str], identity: dict) -> None:
    if inspect_inputs(root, roots) != identity:
        raise AdapterError("Selected source identity changed")


def snapshot(root: Path, destination: Path, roots: list[str]) -> dict:
    """Copy into a caller-owned fresh 0700 tree; compare copy and current source."""
    try:
        info = destination.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or
                info.st_uid != os.getuid() or any(destination.iterdir())):
            raise AdapterError("Staging must be an empty owned 0700 directory")
        source_path = root.resolve(strict=True)
        stage_path = destination.resolve(strict=True)
        if stage_path.is_relative_to(source_path) or source_path.is_relative_to(stage_path):
            raise AdapterError("Staging and source must be disjoint")
        # Prevent a caller-supplied linked ancestor from redirecting staging.
        if any(parent.is_symlink() for parent in (destination, *destination.parents)):
            raise AdapterError("Staging path contains a symlink")
        copied = _scan(root, roots, destination)
        identity = inspect_inputs(destination, roots)
        if copied != identity:
            raise AdapterError("Copied input identity differs from streamed bytes")
        recheck_source(root, roots, identity)
        return identity
    except OSError as error:
        raise AdapterError("Staging failed: " + str(error)) from error


def main(argv: list[str]) -> int:
    try:
        parse_selection(argv)
        require_engine_readiness()
    except AdapterError as error:
        # Not a satisfying receipt: lifecycle/startup/tests are not implemented.
        print("OCI adapter unavailable: " + str(error), file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

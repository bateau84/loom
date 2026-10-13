#!/usr/bin/env python3
"""Export the old tracked OpenCode bundle into a new directory. Never overwrite."""
from __future__ import annotations
import argparse
import io
from pathlib import Path
import subprocess
import tarfile

BASE = "c16e2c793b8faa8d21cf2ca9833606676e461e79"
PATHS = ["agents", "skills", "themes", "profiles.json", "scripts/ocw.sh", "scripts/ocw.zsh", "scripts/ocw.fish"]

def export(destination: Path, source_ref: str, repository: Path) -> None:
    destination = destination.expanduser().resolve()
    if destination.exists():
        raise ValueError(f"Destination already exists; nothing overwritten: {destination}")
    root = Path(subprocess.check_output(["git", "-C", str(repository), "rev-parse", "--show-toplevel"], text=True).strip()).resolve()
    if destination == root or root in destination.parents:
        raise ValueError("Destination must be outside the plugin checkout")
    if source_ref.startswith("-"):
        raise ValueError("Source ref must not begin with a dash")
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "--verify", source_ref + "^{commit}"], text=True).strip()
    archive = subprocess.check_output(["git", "-C", str(root), "archive", "--format=tar", commit, "--", *PATHS])
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as tar:
        members = tar.getmembers()
        for entry in members:
            path = Path(entry.name)
            if path.is_absolute() or ".." in path.parts or not (entry.isfile() or entry.isdir()):
                raise ValueError(f"Unsupported archive entry: {entry.name}")
        destination.mkdir(parents=True, mode=0o700)
        for entry in members:
            target = destination / entry.name
            if entry.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                stream = tar.extractfile(entry)
                if stream is None:
                    raise ValueError(f"Missing archive content: {entry.name}")
                with target.open("xb") as out:
                    out.write(stream.read())
                target.chmod(entry.mode & 0o777)
    (destination / "LOOM-EXPORT.txt").write_text(
        f"Exact tracked configuration exported from {commit}.\n"
        "Untracked local files and secrets were not exported.\n"
        "Agent prompts may contain OLD Loom tool instructions. Port them before use with the redesigned plugin.\n",
        encoding="utf-8",
    )
    print(f"Exported tracked configuration from {commit} to {destination}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--ref", default=BASE, help="Existing commit/branch containing the definitions to preserve")
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        export(args.destination, args.ref, args.repository)
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        parser.exit(1, f"Export failed: {error}\n")

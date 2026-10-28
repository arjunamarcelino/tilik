"""Two runs with the same seed must be byte-for-byte identical, including the dummy files."""

import hashlib
import subprocess
import sys
from pathlib import Path

from tilik_synth.cli import main

ACCEPTANCE = ["--episodes", "60", "--seed-fraud", "--seed", "42"]
CHECKSUMS = Path(__file__).resolve().parents[1] / "checksums.txt"


def _run(out):
    assert main([*ACCEPTANCE, "--out", str(out), "--quiet"]) == 0


def _read_all(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_two_runs_identical(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    _run(a)
    _run(b)
    assert _read_all(a) == _read_all(b)


def test_identical_across_hash_seeds(tmp_path):
    # Different PYTHONHASHSEED in separate PROCESSES — a same-process pair cannot catch hash-ordering drift.
    a, b = tmp_path / "a", tmp_path / "b"
    for out, seed in ((a, "0"), (b, "12345")):
        subprocess.run(
            [sys.executable, "-m", "tilik_synth.cli", *ACCEPTANCE, "--out", str(out), "--quiet"],
            check=True,
            env={"PATH": __import__("os").environ.get("PATH", ""), "PYTHONHASHSEED": seed},
        )
    assert _read_all(a) == _read_all(b)


def test_matches_committed_checksums(tmp_path):
    # The golden file pins the bytes for the current toolchain; regeneration must reproduce it exactly.
    out = tmp_path / "out"
    _run(out)
    actual = {
        f"./{p.relative_to(out).as_posix()}": hashlib.sha256(p.read_bytes()).hexdigest()
        for p in out.rglob("*")
        if p.is_file()
    }
    expected = {}
    for line in CHECKSUMS.read_text().splitlines():
        digest, path = line.split(None, 1)
        expected[path.strip()] = digest
    assert actual == expected


def test_clean_only_mode(tmp_path):
    out = tmp_path / "clean"
    assert main(["--episodes", "10", "--seed", "1", "--out", str(out), "--quiet"]) == 0
    import json

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"]["byCategory"] == {"clean": 10}

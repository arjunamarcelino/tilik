"""Two runs with the same seed must be byte-for-byte identical, including the dummy files."""

from tilik_synth.cli import main


def _run(out):
    assert main(["--episodes", "60", "--seed-fraud", "--seed", "42", "--out", str(out), "--quiet"]) == 0


def _read_all(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_two_runs_identical(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    _run(a)
    _run(b)
    assert _read_all(a) == _read_all(b)


def test_clean_only_mode(tmp_path):
    out = tmp_path / "clean"
    assert main(["--episodes", "10", "--seed", "1", "--out", str(out), "--quiet"]) == 0
    import json

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"]["byCategory"] == {"clean": 10}

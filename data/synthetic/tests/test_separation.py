"""The cloning-vs-SOAP precision claim must hold by construction, not just in prose.

The generator stamps expectFinding=True on cloning and False on the SOAP-template exception. That labelling
is only valid if the two clusters actually sit on opposite sides of a near-duplicate threshold. Assert it
here (word-3-shingle Jaccard, no sklearn dependency) so a narrative edit that collapses the gap fails CI.
"""

import json

from tilik_synth.cli import main


def _shingles(text: str) -> set:
    w = text.split()
    return {tuple(w[i : i + 3]) for i in range(len(w) - 2)}


def _jaccard(a: str, b: str) -> float:
    sa, sb = _shingles(a), _shingles(b)
    return len(sa & sb) / len(sa | sb) if (sa or sb) else 0.0


def _pairwise(texts: list[str]) -> list[float]:
    return [_jaccard(texts[i], texts[j]) for i in range(len(texts)) for j in range(i + 1, len(texts))]


def test_cloning_and_soap_clusters_are_separable(tmp_path):
    out = tmp_path / "out"
    assert main(["--episodes", "60", "--seed-fraud", "--seed", "42", "--out", str(out), "--quiet"]) == 0
    evidence = json.loads((out / "evidence-records.json").read_text(encoding="utf-8"))
    labels = json.loads((out / "manifest.json").read_text(encoding="utf-8"))["labels"]

    clone, soap = [], []
    for e in evidence:
        narrative = (e.get("payload") or {}).get("narrative")
        if not narrative:
            continue
        category = labels[e["episodeRef"]]["category"]
        if category == "fraud_cloning":
            clone.append(narrative)
        elif category == "exception_soap_template":
            soap.append(narrative)

    clone_pw, soap_pw = _pairwise(clone), _pairwise(soap)
    assert clone_pw and soap_pw, "both clusters need at least a pair to compare"

    clone_min, soap_max = min(clone_pw), max(soap_pw)
    # Cloning stays high (copy-paste), SOAP stays at the boilerplate floor, with a wide gap between them.
    assert clone_min > 0.8, f"cloning similarity dropped to {clone_min:.3f}"
    assert soap_max < 0.5, f"SOAP similarity rose to {soap_max:.3f}"
    assert soap_max < clone_min, f"clusters overlap: soap_max={soap_max:.3f} >= clone_min={clone_min:.3f}"

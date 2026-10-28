"""The no-PII guard must catch identifier-shaped strings (incl. grouped) and never call a forbidden
Faker provider — while not false-positiving on the generator's own synthetic refs/codes/amounts."""

import json

import pytest

from tilik_synth.bundle import GuardError, _scan, _scan_text
from tilik_synth.cli import main
from tilik_synth.gen import SafeFaker

MUST_FLAG = [
    "3173052208900001",  # contiguous 16-digit NIK
    "3173 0522 0890 0001",  # grouped NIK (spaces)
    "09.254.294.3-407.000",  # dotted/dashed NPWP
    "0001234567890",  # 13-digit BPJS
    "0812345678901",  # phone-ish long run
    "pasien 3173052208900001 dirawat",  # embedded in free text
    "3173/0522/0890/0001",  # slash-grouped KK
    "1,234,567,890,123",  # comma-grouped
]

MUST_NOT_FLAG = [
    "SYN-PATIENT-0001",
    "SYN-FAC-03",
    "SYN-CLM-0042",
    "N18.5",
    "K35.80",
    "A-4-10-III",
    "2026-01-14T08:00:00Z",
]


@pytest.mark.parametrize("bad", MUST_FLAG)
def test_guard_flags_identifiers(bad):
    with pytest.raises(GuardError):
        _scan_text(bad, "test")


@pytest.mark.parametrize("ok", MUST_NOT_FLAG)
def test_guard_allows_synthetic_tokens(ok):
    _scan_text(ok, "test")  # must not raise


def test_amount_field_is_skipped_by_scan():
    # A 12-digit integer part is legal for Decimal(14,2); the scan must not flag the amount value.
    _scan({"amount": "999999999999.00"}, "claim")  # must not raise


def test_amount_like_value_in_other_field_is_flagged():
    with pytest.raises(GuardError):
        _scan({"note": "999999999999"}, "claim")


def test_non_amount_value_under_amount_key_is_still_scanned():
    # Only a validated Decimal(14,2) string is exempt; a PII-shaped value under 'amount' must not hide.
    with pytest.raises(GuardError):
        _scan({"amount": "3173052208900001"}, "claim")


@pytest.mark.parametrize("method", ["ssn", "address", "postcode", "phone_number", "email", "license_plate", "company"])
def test_forbidden_faker_providers_raise(method):
    f = SafeFaker("id_ID", 42)
    with pytest.raises(AttributeError):
        getattr(f, method)


def test_allowed_faker_providers_work():
    f = SafeFaker("id_ID", 42)
    assert isinstance(f.name(), str) and f.name()


def test_identifier_shaped_seed_is_rejected(tmp_path):
    # An integer --seed serializes to raw digits in manifest.generator.seed; the guard must still catch it.
    rc = main(["--episodes", "30", "--seed-fraud", "--seed", "3173052208900001", "--out", str(tmp_path / "out"), "--quiet"])
    assert rc == 1
    assert not (tmp_path / "out").exists()  # guard fails before any write


def test_end_to_end_bundle_is_well_formed(tmp_path):
    rc = main(["--episodes", "30", "--seed-fraud", "--seed", "7", "--out", str(tmp_path / "out"), "--quiet"])
    assert rc == 0
    out = tmp_path / "out"
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"]["episodes"] == 30
    # every episode is labeled, and both exception families are present (the over-flag proof)
    assert len(manifest["labels"]) == 30
    cats = manifest["counts"]["byCategory"]
    assert cats["exception_repeatable_procedure"] >= 1 and cats["exception_soap_template"] >= 1
    assert cats["fraud_repeat_billing"] >= 1 and cats["fraud_cloning"] >= 1 and cats["fraud_contradiction"] >= 1

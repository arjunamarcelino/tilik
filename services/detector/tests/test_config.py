"""Config parsing — detector tuning fields (pure; no DB, no env mutation)."""

from __future__ import annotations

import pytest

from detector.config import Config, ConfigError

_BASE = {"APP_DATABASE_URL": "postgresql://tilik_app:x@localhost:5432/db"}


def _env(**overrides) -> dict[str, str]:
    return {**_BASE, **overrides}


def test_zero_cloning_threshold_is_rejected() -> None:
    with pytest.raises(ConfigError):
        Config.from_env(_env(DETECTOR_CLONING_THRESHOLD="0"))


def test_nan_cloning_threshold_is_rejected() -> None:
    with pytest.raises(ConfigError):
        Config.from_env(_env(DETECTOR_CLONING_THRESHOLD="nan"))


def test_out_of_range_cloning_threshold_is_rejected() -> None:
    with pytest.raises(ConfigError):
        Config.from_env(_env(DETECTOR_CLONING_THRESHOLD="1.5"))


def test_valid_cloning_threshold_is_parsed() -> None:
    assert Config.from_env(_env(DETECTOR_CLONING_THRESHOLD="0.9")).cloning_threshold == 0.9


def test_exception_codes_unset_uses_default() -> None:
    assert Config.from_env(_env()).repeat_exception_codes == frozenset({"39.95", "99.25"})


def test_exception_codes_explicit_empty_is_honored() -> None:
    # Distinct from unset: an operator opting out of all exceptions must get an empty set, not the default.
    assert Config.from_env(_env(DETECTOR_REPEAT_EXCEPTION_CODES="")).repeat_exception_codes == frozenset()


def test_exception_codes_are_parsed_and_stripped() -> None:
    codes = Config.from_env(_env(DETECTOR_REPEAT_EXCEPTION_CODES=" 39.95 , 50.11 ")).repeat_exception_codes
    assert codes == frozenset({"39.95", "50.11"})

"""Patient pseudonymization — byte-identical to the API's ``patientToken`` helper.

    patientToken = HMAC-SHA256(key, "patient:" + normalize(patientRef)) -> lowercase hex

Spec mirror of ``packages/shared/src/tokenization.ts`` + ``apps/api/src/imports/tokenize.ts``. Parity is
proven by ``tests/test_tokenize_vectors.py`` against the committed golden fixture
``test-vectors/tokenization.vectors.json`` (the same file the API's ``pnpm --filter @tilik/api test:vectors``
asserts), so any drift on either side is caught.

Named ``tokenizer`` (not ``tokenize``) to avoid shadowing the stdlib ``tokenize`` module. This module is
PURE (stdlib only) so tests can exercise it with no DB and no real secret.
"""

from __future__ import annotations

import hashlib
import hmac
import unicodedata

# Domain-separation prefix, so a patient id can never collide with another identifier type.
PATIENT_TOKEN_DOMAIN = "patient:"


def normalize_patient_ref(raw: str) -> str:
    """Canonical normalization applied before HMAC: NFC -> strip -> upper.

    Must stay byte-for-byte identical to the TS ``normalizePatientRef``. patientRef is ASCII-restricted at
    the API DTO boundary, so Python ``str.upper()`` and JS ``toUpperCase()`` cannot diverge on
    locale-sensitive/compound casing.
    """
    return unicodedata.normalize("NFC", raw).strip().upper()


def patient_token(raw_patient_ref: str, key: str) -> str:
    """HMAC-SHA256 patient token as lowercase hex.

    ``key`` is consumed as the literal env-string's UTF-8 bytes (never base64-decoded), matching TS
    ``Buffer.from(key, 'utf8')``; the message is explicit UTF-8. The raw patientRef is NEVER persisted —
    only this token.
    """
    message = (PATIENT_TOKEN_DOMAIN + normalize_patient_ref(raw_patient_ref)).encode("utf-8")
    return hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()

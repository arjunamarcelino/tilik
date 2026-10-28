// Patient pseudonymization spec — shared so the Python detector (Prompt 07) reproduces identical tokens.
//
// patientToken = HMAC-SHA256(key, PATIENT_TOKEN_DOMAIN + normalizePatientRef(raw)) → lowercase hex.
//
// This module is PURE (no node:crypto) so it is safe to import anywhere and the normalization rule is
// explicit for the Python side. The HMAC itself lives in the API (apps/api/src/imports/tokenize.ts),
// keyed by PATIENT_TOKEN_HMAC_KEY; the key is consumed as the literal env-string's UTF-8 bytes (never
// base64-decoded) so TS `Buffer.from(key,'utf8')` and Python `key.encode('utf-8')` agree.
//
// Python mirror:
//   import unicodedata
//   def normalize_patient_ref(raw): return unicodedata.normalize('NFC', raw).strip().upper()
//
// Determinism note: patientRef is ASCII-restricted at the DTO boundary, so JS `toUpperCase()` and
// Python `str.upper()` cannot diverge on locale-sensitive/compound casing.

/** Domain-separation prefix, so a patient id can never collide with another identifier type. */
export const PATIENT_TOKEN_DOMAIN = 'patient:';

/** Canonical normalization applied before HMAC. Must stay byte-for-byte identical in the Python detector. */
export const normalizePatientRef = (raw: string): string => raw.normalize('NFC').trim().toUpperCase();

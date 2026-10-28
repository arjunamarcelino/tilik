import { createHmac } from 'node:crypto';
import { normalizePatientRef, PATIENT_TOKEN_DOMAIN } from '@tilik/shared';

/**
 * patientToken = HMAC-SHA256(key, "patient:" + normalize(patientRef)) → lowercase hex.
 *
 * The raw patientRef is NEVER persisted — only this token. `key` is the literal PATIENT_TOKEN_HMAC_KEY
 * env string's UTF-8 bytes (not base64-decoded); the message is explicit UTF-8. Mirrored in the Python
 * detector (Prompt 07) against test-vectors/tokenization.vectors.json. See @tilik/shared/tokenization.
 */
export function patientToken(rawPatientRef: string, key: string): string {
  const message = Buffer.from(PATIENT_TOKEN_DOMAIN + normalizePatientRef(rawPatientRef), 'utf8');
  return createHmac('sha256', Buffer.from(key, 'utf8')).update(message).digest('hex');
}

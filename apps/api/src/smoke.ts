/**
 * Phase-1 smoke import: proves `@tilik/shared` resolves and type-checks from
 * another workspace package. Replaced by the real NestJS entrypoint in Prompt 05.
 */
import { DetectorType, Role } from '@tilik/shared';

const detector: DetectorType = DetectorType.CLONING;
const role: Role = Role.ADMIN;

export const SMOKE_OK = `${detector}:${role}`;

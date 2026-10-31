import { CaseStatus, DetectorType, Severity } from '@tilik/shared';

/**
 * Human labels for the case enums. Pure data (no JSX, no 'use client'), so both server components
 * (badge) and client components (filters) import it without bundling component code — one source of
 * truth instead of copies that can silently diverge. Keyed over the enum so a new member is a compile error.
 */
export const SEVERITY_LABEL: Record<Severity, string> = {
  [Severity.LOW]: 'Low',
  [Severity.MEDIUM]: 'Medium',
  [Severity.HIGH]: 'High',
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  [CaseStatus.OPEN]: 'Open',
  [CaseStatus.IN_REVIEW]: 'In review',
  [CaseStatus.PENDING]: 'Pending',
  [CaseStatus.ESCALATED]: 'Escalated',
  [CaseStatus.CLOSED]: 'Closed',
};

export const DETECTOR_LABEL: Record<DetectorType, string> = {
  [DetectorType.REPEAT_BILLING]: 'Repeat billing',
  [DetectorType.CLONING]: 'Cloning',
  [DetectorType.PERTENTANGAN_BUKTI]: 'Contradiction',
};

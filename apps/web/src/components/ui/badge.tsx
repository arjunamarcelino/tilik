import { CaseStatus, DetectorType, Severity } from '@tilik/shared';

type Tone = 'low' | 'med' | 'high' | 'neutral' | 'info';

// Each tone pairs a fill/background with its own foreground — AA both ways (see globals.css severity ramp).
const TONE: Record<Tone, string> = {
  low: 'bg-sev-low-bg text-sev-low',
  med: 'bg-sev-med-bg text-sev-med',
  high: 'bg-sev-high-bg text-sev-high',
  neutral: 'border border-border bg-canvas text-brand-ink/80',
  info: 'bg-brand-navy/10 text-brand-navy',
};

/** Small label pill. Always carries text — color is never the only signal (globals.css rule). */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  [Severity.LOW]: 'low',
  [Severity.MEDIUM]: 'med',
  [Severity.HIGH]: 'high',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  [Severity.LOW]: 'Low',
  [Severity.MEDIUM]: 'Medium',
  [Severity.HIGH]: 'High',
};
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  [CaseStatus.OPEN]: 'Open',
  [CaseStatus.IN_REVIEW]: 'In review',
  [CaseStatus.PENDING]: 'Pending',
  [CaseStatus.ESCALATED]: 'Escalated',
  [CaseStatus.CLOSED]: 'Closed',
};
export function StatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone="neutral">{STATUS_LABEL[status]}</Badge>;
}

const DETECTOR_LABEL: Record<DetectorType, string> = {
  [DetectorType.REPEAT_BILLING]: 'Repeat billing',
  [DetectorType.CLONING]: 'Cloning',
  [DetectorType.PERTENTANGAN_BUKTI]: 'Contradiction',
};
export function DetectorBadge({ detector }: { detector: DetectorType }) {
  return <Badge tone="info">{DETECTOR_LABEL[detector]}</Badge>;
}

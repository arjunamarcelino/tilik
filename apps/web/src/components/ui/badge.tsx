import { CaseStatus, DetectorType, Severity, Verdict } from '@tilik/shared';
import { DETECTOR_LABEL, SEVERITY_LABEL, STATUS_LABEL, VERDICT_LABEL } from '../cases/labels';

type Tone = 'low' | 'med' | 'high' | 'neutral' | 'info' | 'good';

// Each tone pairs a fill/background with its own foreground — AA both ways (see globals.css severity ramp).
const TONE: Record<Tone, string> = {
  low: 'bg-sev-low-bg text-sev-low',
  med: 'bg-sev-med-bg text-sev-med',
  high: 'bg-sev-high-bg text-sev-high',
  neutral: 'border border-border bg-canvas text-brand-ink/80',
  info: 'bg-brand-navy/10 text-brand-navy',
  good: 'bg-ok-bg text-ok',
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
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone="neutral">{STATUS_LABEL[status]}</Badge>;
}

export function DetectorBadge({ detector }: { detector: DetectorType }) {
  return <Badge tone="info">{DETECTOR_LABEL[detector]}</Badge>;
}

// The reviewer's verdict: confirmed fraud (red) / not fraud (green) / needs more info (amber). This is the
// authoritative outcome — Case.status only shows the lifecycle (escalated/closed/pending) it lands in.
const VERDICT_TONE: Record<Verdict, Tone> = {
  [Verdict.CONFIRMED_FRAUD]: 'high',
  [Verdict.NOT_FRAUD]: 'good',
  [Verdict.NEEDS_MORE_INFO]: 'med',
};
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}

import type { IScanFinding } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown' | 'none';

/** Sort and display order for findings. `none` is a result, not a rank. */
export const SEVERITY_ORDER: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
] as const;

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
  none: 'Clean',
};

const SEVERITY_CLASS: Record<Severity, string> = {
  critical:
    'border-[hsl(var(--severity-critical))]/25 bg-[hsl(var(--severity-critical))]/10 text-[hsl(var(--severity-critical))]',
  high: 'border-[hsl(var(--severity-high))]/25 bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]',
  medium:
    'border-[hsl(var(--severity-medium))]/25 bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]',
  low: 'border-[hsl(var(--severity-low))]/25 bg-[hsl(var(--severity-low))]/10 text-[hsl(var(--severity-low))]',
  unknown:
    'border-[hsl(var(--severity-unknown))]/25 bg-[hsl(var(--severity-unknown))]/10 text-[hsl(var(--severity-unknown))]',
  none: 'border-[hsl(var(--severity-none))]/25 bg-[hsl(var(--severity-none))]/10 text-[hsl(var(--severity-none))]',
};

/** Trivy reports uppercase; the tokens and sort order are lowercase. */
export function severityFromFinding(finding: IScanFinding): Severity {
  const lowered = finding.severity.toLowerCase();
  const known = SEVERITY_ORDER.find((severity) => severity === lowered);
  return known ?? 'unknown';
}

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABEL[severity];
}

interface SeverityBadgeProps {
  severity: Severity;
  /** Omit for a bare severity label, e.g. in a findings table. */
  count?: number;
  /** Number only, with the severity kept in the accessible name. */
  compact?: boolean;
  className?: string;
}

export function SeverityBadge({ severity, count, compact, className }: SeverityBadgeProps) {
  const label = SEVERITY_LABEL[severity];
  const accessibleName = count === undefined ? label : `${count} ${label.toLowerCase()}`;

  let text = label;
  if (compact) {
    text = String(count ?? 0);
  } else if (count !== undefined) {
    text = `${count} ${label}`;
  }

  return (
    <Badge
      variant="outline"
      aria-label={accessibleName}
      className={cn('px-1.5 py-0 text-[10px] font-mono', SEVERITY_CLASS[severity], className)}
    >
      {text}
    </Badge>
  );
}

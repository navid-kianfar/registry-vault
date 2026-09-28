import { Loader2 } from 'lucide-react';
import type { IVulnerabilitySummary } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SEVERITY_ORDER, SeverityBadge, type Severity } from '@/components/shared/severity-badge';

function countFor(summary: IVulnerabilitySummary, severity: Severity): number {
  switch (severity) {
    case 'critical':
      return summary.critical;
    case 'high':
      return summary.high;
    case 'medium':
      return summary.medium;
    case 'low':
      return summary.low;
    case 'unknown':
      return summary.unknown ?? 0;
    case 'none':
      return 0;
    default: {
      const exhaustive: never = severity;
      throw new Error(`Unhandled severity: ${String(exhaustive)}`);
    }
  }
}

/**
 * What a tag's scan actually says. "Clean" is reserved for a tag that was
 * scanned and came back empty — an unscanned tag says so, instead of reporting
 * an image nobody has checked as safe.
 */
export function TagScanStatus({
  summary,
  scanError,
}: {
  summary: IVulnerabilitySummary;
  scanError?: string;
}) {
  if (summary.scanState === 'queued') {
    return (
      <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
        Scan queued
      </Badge>
    );
  }

  if (summary.scanState === 'running') {
    return (
      <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Scanning…
      </Badge>
    );
  }

  if (summary.scanState === 'failed') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Badge
              variant="outline"
              className="border-destructive/25 bg-destructive/10 px-1.5 py-0 text-[10px] text-destructive"
            >
              Scan failed
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {scanError ?? 'The agent did not report a reason.'}
        </TooltipContent>
      </Tooltip>
    );
  }

  const found = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: countFor(summary, severity),
  })).filter((entry) => entry.count > 0);

  if (found.length > 0) {
    return (
      <div className="flex items-center gap-1">
        {found.map((entry) => (
          <SeverityBadge key={entry.severity} severity={entry.severity} count={entry.count} />
        ))}
      </div>
    );
  }

  if (summary.lastScannedAt) {
    return <SeverityBadge severity="none" />;
  }

  return (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
      Not scanned
    </Badge>
  );
}

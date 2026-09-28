import type { IAgentDisk } from '@registry-vault/shared';
import { formatBytes } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface DiskUsageBarProps {
  disk: IAgentDisk;
  /** Turns the fill red; set by the agent from the connection's threshold. */
  lowDisk?: boolean;
  /** Adds "78% used" / "44.1 GB free of 200 GB" under the bar. */
  showLabels?: boolean;
  className?: string;
}

const MAX_PERCENT = 100;

export function DiskUsageBar({ disk, lowDisk, showLabels, className }: DiskUsageBarProps) {
  // The agent computes usedPercent from statfs; recomputing it here would drift.
  // Reserved blocks on ext4 can push it past 100, which must not overflow the bar.
  const percent = Math.round(disk.usedPercent);
  const width = Math.min(disk.usedPercent, MAX_PERCENT);
  const free = formatBytes(disk.freeBytes);
  const total = formatBytes(disk.totalBytes);

  return (
    <div className={cn('space-y-1', className)}>
      <div
        role="progressbar"
        aria-label="Disk usage"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={MAX_PERCENT}
        aria-valuetext={`${percent}% used, ${free} free of ${total}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            'h-2 rounded-full transition-all',
            lowDisk ? 'bg-[hsl(var(--severity-high))]' : 'bg-primary',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {showLabels && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{percent}% used</span>
          <span>
            {free} free of {total}
          </span>
        </div>
      )}
    </div>
  );
}

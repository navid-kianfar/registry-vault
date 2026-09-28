import { format, formatDistanceToNow } from 'date-fns';

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function formatDate(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy');
}

export function formatDateTime(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy HH:mm');
}

export function formatRelativeTime(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

/**
 * Relative time for a value that may be absent. Always use this for a nullable
 * timestamp: `formatRelativeTime(null)` renders "over 56 years ago" (the epoch)
 * rather than failing, which types cannot catch and a reader will believe.
 */
export function formatRelativeTimeOr(value?: string | null, fallback = 'Never'): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return formatDistanceToNow(date, { addSuffix: true });
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/** Compact duration: `41s`, `3m 41s`, `2h 4m`, `6d 3h`. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';

  const totalSeconds = Math.round(milliseconds / MS_PER_SECOND);
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`;

  if (totalSeconds < SECONDS_PER_HOUR) {
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  if (totalSeconds < SECONDS_PER_DAY) {
    const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function formatPercentage(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

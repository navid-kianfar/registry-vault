import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  /** Description; sits under the title. */
  children?: ReactNode;
  /** Overrides the per-tone default icon. */
  icon?: ReactNode;
  /** One Button. Right-aligned from `sm` up, below the text on a phone. */
  action?: ReactNode;
  className?: string;
}

const TONE_CONTAINER: Record<NoticeTone, string> = {
  info: 'border-border bg-muted/50',
  warning: 'border-[hsl(var(--severity-medium))]/25 bg-[hsl(var(--severity-medium))]/10',
  danger: 'border-destructive/25 bg-destructive/10',
  success: 'border-[hsl(var(--severity-none))]/25 bg-[hsl(var(--severity-none))]/10',
};

const TONE_ICON_COLOR: Record<NoticeTone, string> = {
  info: 'text-muted-foreground',
  warning: 'text-[hsl(var(--severity-medium))]',
  danger: 'text-destructive',
  success: 'text-[hsl(var(--severity-none))]',
};

function defaultIcon(tone: NoticeTone, className: string): ReactNode {
  switch (tone) {
    case 'info':
      return <Info className={className} />;
    case 'warning':
      return <AlertTriangle className={className} />;
    case 'danger':
      return <AlertCircle className={className} />;
    case 'success':
      return <CheckCircle2 className={className} />;
    default: {
      const exhaustive: never = tone;
      throw new Error(`Unhandled notice tone: ${String(exhaustive)}`);
    }
  }
}

/**
 * The app's banner idiom, in one place. Body text stays on foreground /
 * muted-foreground so contrast never depends on the tinted background — tone
 * lives in the border, the tint and the icon.
 */
export function Notice({ tone = 'info', title, children, icon, action, className }: NoticeProps) {
  const iconClassName = cn('h-4 w-4 shrink-0 mt-0.5', TONE_ICON_COLOR[tone]);
  const renderedIcon = icon ?? defaultIcon(tone, iconClassName);

  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between',
        TONE_CONTAINER[tone],
        className,
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        {renderedIcon}
        <div className="min-w-0 space-y-0.5">
          {title && <p className="font-medium text-foreground">{title}</p>}
          {children && <div className="text-muted-foreground">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 sm:ml-4 [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
    </div>
  );
}

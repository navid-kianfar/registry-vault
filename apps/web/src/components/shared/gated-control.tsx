import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Permission copy, in one place so two screens cannot word it differently. */
export const ADMIN_ONLY_REASON = 'Only administrators can change this.';
export const CURATE_ONLY_REASON = 'Only administrators and maintainers can do this.';
export const GC_RUNNING_REASON = 'Not while garbage collection is running.';

/**
 * A disabled button emits no pointer events, so the explanation has to hang off
 * a wrapper — without it the control is simply dead and unexplained.
 */
export function DisabledReason({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/** Wraps a control in its explanation only when it is actually disabled. */
export function GatedControl({
  disabled,
  reason,
  children,
}: {
  disabled: boolean;
  reason: string;
  children: ReactNode;
}) {
  if (!disabled) return <>{children}</>;
  return <DisabledReason reason={reason}>{children}</DisabledReason>;
}

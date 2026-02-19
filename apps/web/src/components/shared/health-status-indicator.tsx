import { HealthStatus } from '@registryvault/shared';
import { cn } from '@/lib/utils';

const statusConfig = {
  [HealthStatus.Healthy]: { label: 'Healthy', color: 'bg-emerald-500', textColor: 'text-emerald-500' },
  [HealthStatus.Degraded]: { label: 'Degraded', color: 'bg-yellow-500', textColor: 'text-yellow-500' },
  [HealthStatus.Unhealthy]: { label: 'Unhealthy', color: 'bg-red-500', textColor: 'text-red-500' },
  [HealthStatus.Unknown]: { label: 'Unknown', color: 'bg-gray-400', textColor: 'text-gray-400' },
};

interface HealthStatusIndicatorProps {
  status: HealthStatus;
  showLabel?: boolean;
  className?: string;
}

export function HealthStatusIndicator({ status, showLabel = true, className }: HealthStatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative flex h-2.5 w-2.5">
        {status === HealthStatus.Healthy && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', config.color)} />
        )}
        <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', config.color)} />
      </div>
      {showLabel && (
        <span className={cn('text-sm font-medium', config.textColor)}>
          {config.label}
        </span>
      )}
    </div>
  );
}

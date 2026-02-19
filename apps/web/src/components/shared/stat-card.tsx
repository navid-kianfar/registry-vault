import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: number;
  trendLabel?: string;
  className?: string;
}

export function StatCard({ label, value, icon, trend, trendLabel, className }: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </div>
        <div className="mt-2">
          <p className="text-2xl font-bold">{value}</p>
          {trend !== undefined && (
            <div className="mt-1 flex items-center gap-1 text-xs">
              {trend >= 0 ? (
                <ArrowUp className="h-3 w-3 text-emerald-500" />
              ) : (
                <ArrowDown className="h-3 w-3 text-red-500" />
              )}
              <span className={cn(trend >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                {Math.abs(trend)}%
              </span>
              {trendLabel && (
                <span className="text-muted-foreground">{trendLabel}</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

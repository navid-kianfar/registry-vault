import { Badge } from '@/components/ui/badge';
import { RegistryType, REGISTRY_LABELS } from '@registryvault/shared';
import { cn } from '@/lib/utils';
import { Container, Package, Box } from 'lucide-react';

const registryConfig = {
  [RegistryType.Docker]: {
    icon: Container,
    className: 'bg-[hsl(var(--docker))]/10 text-[hsl(var(--docker))] border-[hsl(var(--docker))]/20',
  },
  [RegistryType.NuGet]: {
    icon: Package,
    className: 'bg-[hsl(var(--nuget))]/10 text-[hsl(var(--nuget))] border-[hsl(var(--nuget))]/20',
  },
  [RegistryType.NPM]: {
    icon: Box,
    className: 'bg-[hsl(var(--npm))]/10 text-[hsl(var(--npm))] border-[hsl(var(--npm))]/20',
  },
};

interface RegistryBadgeProps {
  type: RegistryType;
  className?: string;
}

export function RegistryBadge({ type, className }: RegistryBadgeProps) {
  const config = registryConfig[type];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', config.className, className)}>
      <Icon className="h-3 w-3" />
      {REGISTRY_LABELS[type]}
    </Badge>
  );
}

import { Cpu } from 'lucide-react';
import type { IDockerPlatform } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';

/** `linux/arm/v7` — the form users see in `docker manifest inspect`. */
export function formatPlatform(platform: IDockerPlatform): string {
  const base = `${platform.os}/${platform.architecture}`;
  return platform.variant ? `${base}/${platform.variant}` : base;
}

/**
 * Runnable platforms only. buildx records provenance/SBOM as extra index
 * entries with an `unknown/unknown` platform; they are not images.
 */
export function runnablePlatforms(platforms: IDockerPlatform[] = []): IDockerPlatform[] {
  return platforms.filter(
    (p) => !p.isAttestation && p.architecture !== 'unknown' && p.os !== 'unknown',
  );
}

/**
 * Every platform a tag publishes. A multi-arch tag lists each one instead of
 * collapsing to whichever platform happened to be resolved first.
 */
export function PlatformBadges({
  platforms,
  max = 3,
}: {
  platforms: IDockerPlatform[];
  max?: number;
}) {
  const runnable = runnablePlatforms(platforms);
  if (runnable.length === 0) return null;

  const shown = runnable.slice(0, max);
  const overflow = runnable.length - shown.length;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {shown.map((platform) => (
        <Badge
          key={platform.digest || formatPlatform(platform)}
          variant="outline"
          className="text-[10px] font-mono px-1.5 py-0"
        >
          <Cpu className="h-2.5 w-2.5 mr-1" />
          {formatPlatform(platform)}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}

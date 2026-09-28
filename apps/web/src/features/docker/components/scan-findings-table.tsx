import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import type { IScanFinding } from '@registry-vault/shared';
import { DEFAULT_PAGE_SIZE } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import {
  SEVERITY_ORDER,
  SeverityBadge,
  severityFromFinding,
  severityLabel,
  type Severity,
} from '@/components/shared/severity-badge';

const SEARCH_DEBOUNCE_MS = 200;

function sortFindings(findings: readonly IScanFinding[]): readonly IScanFinding[] {
  return [...findings].sort((left, right) => {
    const leftRank = SEVERITY_ORDER.indexOf(severityFromFinding(left));
    const rightRank = SEVERITY_ORDER.indexOf(severityFromFinding(right));
    if (leftRank !== rightRank) return leftRank - rightRank;
    const byPackage = left.pkgName.localeCompare(right.pkgName);
    if (byPackage !== 0) return byPackage;
    return left.id.localeCompare(right.id);
  });
}

function InstalledToFixed({ finding }: { finding: IScanFinding }) {
  return (
    <span className="font-mono text-xs">
      {finding.installedVersion} →{' '}
      {finding.fixedVersion ?? (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
          no fix
        </Badge>
      )}
    </span>
  );
}

export function ScanFindingsTable({
  findings,
  caption,
}: {
  findings: readonly IScanFinding[];
  caption: string;
}) {
  const [activeSeverities, setActiveSeverities] = useState<readonly Severity[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const sorted = useMemo(() => sortFindings(findings), [findings]);

  const countsBySeverity = useMemo(() => {
    const counts = new Map<Severity, number>();
    for (const finding of findings) {
      const severity = severityFromFinding(finding);
      counts.set(severity, (counts.get(severity) ?? 0) + 1);
    }
    return counts;
  }, [findings]);

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return sorted.filter((finding) => {
      if (
        activeSeverities.length > 0 &&
        !activeSeverities.includes(severityFromFinding(finding))
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        finding.pkgName.toLowerCase().includes(needle) || finding.id.toLowerCase().includes(needle)
      );
    });
  }, [sorted, activeSeverities, searchTerm]);

  const pageItems = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const hasFilters = activeSeverities.length > 0 || searchTerm.length > 0;

  function toggleSeverity(severity: Severity) {
    setActiveSeverities((current) =>
      current.includes(severity)
        ? current.filter((entry) => entry !== severity)
        : [...current, severity],
    );
    setPage(1);
  }

  function clearFilters() {
    setActiveSeverities([]);
    setSearchInput('');
    setSearchTerm('');
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by severity" className="flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.map((severity) => {
            const count = countsBySeverity.get(severity) ?? 0;
            const isActive = activeSeverities.includes(severity);
            return (
              <Button
                key={severity}
                size="sm"
                variant={isActive ? 'secondary' : 'outline'}
                aria-pressed={isActive}
                disabled={count === 0}
                onClick={() => toggleSeverity(severity)}
              >
                {severityLabel(severity)} {count}
              </Button>
            );
          })}
        </div>

        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="package or CVE"
            aria-label="Filter findings by package or CVE"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Severity</TableHead>
            <TableHead>CVE</TableHead>
            <TableHead>Package</TableHead>
            <TableHead className="hidden sm:table-cell">Installed → Fixed</TableHead>
            <TableHead className="hidden lg:table-cell">Title</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                No findings match these filters.{' '}
                {hasFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Clear filters
                  </button>
                )}
              </TableCell>
            </TableRow>
          ) : (
            pageItems.map((finding) => (
              <TableRow key={`${finding.id}-${finding.pkgName}-${finding.installedVersion}`}>
                <TableCell>
                  <SeverityBadge severity={severityFromFinding(finding)} />
                </TableCell>
                <TableCell>
                  {finding.primaryUrl ? (
                    <a
                      href={finding.primaryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${finding.id} (opens in a new tab)`}
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {finding.id}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-xs">{finding.id}</span>
                  )}
                  <span className="block sm:hidden">
                    <InstalledToFixed finding={finding} />
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{finding.pkgName}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <InstalledToFixed finding={finding} />
                </TableCell>
                <TableCell className="hidden max-w-[320px] lg:table-cell">
                  {finding.title ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="block truncate text-sm">
                          {finding.title}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">{finding.title}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {filtered.length > 0 && (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalCount={filtered.length}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

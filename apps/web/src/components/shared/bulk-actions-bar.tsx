import { useState } from 'react';
import { Trash2, Clock, CalendarX2, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePicker } from '@/components/ui/date-picker';

interface BulkActionsBarProps {
  count: number;
  onDelete: () => void;
  onKeepLastN?: (n: number) => void;
  onDeleteOlderThan?: (date: string) => void;
  onClear: () => void;
  isDeleting?: boolean;
}

export function BulkActionsBar({
  count,
  onDelete,
  onKeepLastN,
  onDeleteOlderThan,
  onClear,
  isDeleting,
}: BulkActionsBarProps) {
  const [keepCount, setKeepCount] = useState(3);
  const [olderThanDate, setOlderThanDate] = useState<Date | undefined>(undefined);
  const [keepOpen, setKeepOpen] = useState(false);
  const [olderOpen, setOlderOpen] = useState(false);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-background border shadow-lg rounded-lg animate-in slide-in-from-bottom-2 fade-in duration-200">
      <Badge variant={count > 0 ? 'secondary' : 'outline'} className="text-sm font-medium tabular-nums">
        {count > 0 ? `${count} selected` : 'None selected'}
      </Badge>

      <div className="h-4 w-px bg-border" />

      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={isDeleting || count === 0}
        className="gap-1.5"
      >
        {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Delete Selected
      </Button>

      {onKeepLastN && (
        <Popover open={keepOpen} onOpenChange={setKeepOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={count === 0 || isDeleting}>
              <Clock className="h-3.5 w-3.5" />
              Keep Last N
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" side="top">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="keep-count">Versions to keep</Label>
                <Input
                  id="keep-count"
                  type="number"
                  min={1}
                  max={100}
                  value={keepCount}
                  onChange={(e) => setKeepCount(Number(e.target.value))}
                />
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  onKeepLastN(keepCount);
                  setKeepOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {onDeleteOlderThan && (
        <Popover open={olderOpen} onOpenChange={setOlderOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={count === 0 || isDeleting}>
              <CalendarX2 className="h-3.5 w-3.5" />
              Delete Older Than
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 space-y-3" side="top">
            <div className="space-y-1.5">
              <Label>Delete versions published before</Label>
              <DatePicker
                value={olderThanDate}
                onChange={setOlderThanDate}
                toDate={new Date()}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!olderThanDate}
              onClick={() => {
                if (olderThanDate) {
                  onDeleteOlderThan(olderThanDate.toISOString());
                  setOlderThanDate(undefined);
                  setOlderOpen(false);
                }
              }}
            >
              Apply
            </Button>
          </PopoverContent>
        </Popover>
      )}

      <div className="h-4 w-px bg-border" />

      <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5">
        <X className="h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}

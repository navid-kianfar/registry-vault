import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ADMIN_ONLY_REASON, GC_RUNNING_REASON, GatedControl } from '../agent-states';

interface RestartCardProps {
  isAdmin: boolean;
  isGcRunning: boolean;
  isRestarting: boolean;
  connectionName: string;
  onRestart: () => void;
}

export function RestartCard({
  isAdmin,
  isGcRunning,
  isRestarting,
  connectionName,
  onRestart,
}: RestartCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isDisabled = !isAdmin || isGcRunning || isRestarting;
  const reason = !isAdmin ? ADMIN_ONLY_REASON : GC_RUNNING_REASON;

  return (
    <Card className="border-destructive/30">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <RotateCcw className="h-4 w-4" /> Restart registry
        </CardTitle>
        <CardDescription>
          Restarts the registry process. Pulls and pushes fail for a few seconds while it comes back.
          The agent itself and this page keep running.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end">
        <GatedControl disabled={isDisabled} reason={reason}>
          <Button variant="destructive" className="gap-1.5" disabled={isDisabled} onClick={() => setConfirmOpen(true)}>
            <RotateCcw className="h-4 w-4" />
            {isRestarting ? 'Restarting…' : 'Restart registry'}
          </Button>
        </GatedControl>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restart the registry?</DialogTitle>
            <DialogDescription>
              Pulls and pushes to <strong>{connectionName}</strong> fail for a few seconds while the
              process restarts. Anything mid-push has to start over.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button autoFocus variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onRestart();
              }}
            >
              Restart registry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

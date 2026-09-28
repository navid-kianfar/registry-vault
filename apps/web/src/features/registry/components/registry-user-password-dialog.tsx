import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyCommand } from '@/components/shared/copy-command';

const COPY_FEEDBACK_MS = 2000;

export interface GeneratedCredentials {
  username: string;
  password: string;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [hasCopied, setHasCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), COPY_FEEDBACK_MS);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0"
      onClick={handleCopy}
      aria-label={label}
      title={label}
    >
      {hasCopied ? (
        <Check className="h-4 w-4 text-[hsl(var(--severity-none))]" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  );
}

/**
 * The reveal itself. Shared by the create flow (which shows it in place of its
 * own form) and the reset flow (which opens it on its own).
 */
export function PasswordRevealContent({
  credentials,
  registryUrl,
  onDone,
}: {
  credentials: GeneratedCredentials;
  registryUrl: string;
  onDone: () => void;
}) {
  const [copyAnnouncement, setCopyAnnouncement] = useState('');

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save this password now</DialogTitle>
        <DialogDescription>
          It is shown once. Registry Vault does not store it and cannot show it again — if you lose
          it, reset the password.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="revealUsername">Username</Label>
          <div className="flex items-center gap-2">
            <Input id="revealUsername" readOnly value={credentials.username} className="font-mono" />
            <CopyButton value={credentials.username} label="Copy username" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="revealPassword">Password</Label>
          <div className="flex items-center gap-2">
            {/* type="text" on purpose: reading it is the whole point of this screen. */}
            <Input id="revealPassword" readOnly type="text" value={credentials.password} className="font-mono" />
            <div onClick={() => setCopyAnnouncement('Password copied')}>
              <CopyButton value={credentials.password} label="Copy password" />
            </div>
          </div>
          <span role="status" className="sr-only">
            {copyAnnouncement}
          </span>
        </div>

        <CopyCommand command={`docker login ${registryUrl} -u ${credentials.username}`} />
      </div>

      <DialogFooter>
        <Button onClick={onDone}>I have saved it</Button>
      </DialogFooter>
    </>
  );
}

/**
 * Esc and the backdrop stay live — a modal you cannot leave is worse than a
 * lost password — but leaving without the button says so.
 */
export function RegistryUserPasswordDialog({
  credentials,
  registryUrl,
  onClose,
}: {
  credentials: GeneratedCredentials | null;
  registryUrl: string;
  onClose: () => void;
}) {
  if (!credentials) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        toast.warning('Password dismissed — reset it if you did not copy it');
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-md [&>button]:hidden">
        <PasswordRevealContent
          credentials={credentials}
          registryUrl={registryUrl}
          onDone={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

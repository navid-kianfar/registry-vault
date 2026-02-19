import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { StorageBackend } from '@registryvault/shared';
import { HardDrive, Cloud, Database, FolderOpen } from 'lucide-react';

const STORAGE_OPTIONS = [
  {
    backend: StorageBackend.Filesystem,
    label: 'Filesystem',
    icon: HardDrive,
    description: 'Local disk storage',
  },
  {
    backend: StorageBackend.S3,
    label: 'Amazon S3',
    icon: Cloud,
    description: 'AWS S3 or compatible',
  },
  {
    backend: StorageBackend.AzureBlob,
    label: 'Azure Blob',
    icon: Cloud,
    description: 'Azure Blob Storage',
  },
  {
    backend: StorageBackend.GCS,
    label: 'Google Cloud Storage',
    icon: Database,
    description: 'GCS buckets',
  },
];

const CURRENT_BACKEND = StorageBackend.Filesystem;
const CURRENT_PATH = '/data/registry';

export default function StorageSettings() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Storage Configuration</CardTitle>
          <CardDescription>Current storage backend and configuration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <HardDrive className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Filesystem</p>
                <p className="text-xs text-muted-foreground">Local disk storage</p>
              </div>
            </div>
            <Badge variant="default">Active</Badge>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Storage Path</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <code className="text-sm">{CURRENT_PATH}</code>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Available Backends</CardTitle>
          <CardDescription>Supported storage backend options.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {STORAGE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = option.backend === CURRENT_BACKEND;

              return (
                <div
                  key={option.backend}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    isActive
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border opacity-60'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-md ${
                      isActive ? 'bg-primary/10' : 'bg-muted'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{option.label}</p>
                      {isActive && (
                        <Badge variant="outline" className="text-[11px]">
                          Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

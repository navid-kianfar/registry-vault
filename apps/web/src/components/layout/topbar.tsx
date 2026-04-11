import { Menu, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { Breadcrumbs } from './breadcrumbs';
import { useSidebar } from '@/hooks/use-sidebar';

export function Topbar() {
  const { setMobileOpen } = useSidebar();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden h-8 w-8"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="flex-1">
          <Breadcrumbs />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="h-8 w-[200px] pl-8 text-sm"
            />
          </div>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

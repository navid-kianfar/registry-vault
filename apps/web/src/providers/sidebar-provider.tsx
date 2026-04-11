import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { SidebarContext } from '@/hooks/use-sidebar';

const STORAGE_KEY = 'registryvault-sidebar-collapsed';

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'true';
  });
  const [isMobileOpen, setMobileOpen] = useState(false);

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <SidebarContext.Provider value={{ isCollapsed, isMobileOpen, toggle, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

import { createContext, useContext } from 'react';

export interface SidebarContextType {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
  isMobileOpen: false,
  toggle: () => {},
  setMobileOpen: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

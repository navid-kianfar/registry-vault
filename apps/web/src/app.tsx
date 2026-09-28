import { RouterProvider } from 'react-router-dom';
import { QueryProvider } from '@/providers/query-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { router } from '@/router';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="registryvault-theme">
      <QueryProvider>
        <AuthProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster richColors position="bottom-right" />
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

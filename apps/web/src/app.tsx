import { RouterProvider } from 'react-router-dom';
import { QueryProvider } from '@/providers/query-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { router } from '@/router';
import { Toaster } from 'sonner';

export function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="registryvault-theme">
      <QueryProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="bottom-right" />
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

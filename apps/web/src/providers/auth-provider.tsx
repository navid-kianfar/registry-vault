import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { IAuthUser, ILoginRequest } from '@registryvault/shared';
import { apiClient } from '@/services/mock/mock-api-client';

const AUTH_TOKEN_KEY = 'registryvault-auth-token';

interface AuthContextValue {
  user: IAuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (request: ILoginRequest) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IAuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setIsLoading(false);
      return;
    }

    apiClient
      .getCurrentUser()
      .then((response) => {
        setUser(response.data);
      })
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (request: ILoginRequest): Promise<boolean> => {
    try {
      const response = await apiClient.login(request);
      localStorage.setItem(AUTH_TOKEN_KEY, response.data.token);
      setUser(response.data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } finally {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

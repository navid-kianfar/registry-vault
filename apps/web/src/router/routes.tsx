import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { AuthGuard } from '@/components/auth/auth-guard';

const DashboardPage = lazy(() => import('@/features/dashboard/pages/dashboard-page'));
const DockerRepositoriesPage = lazy(() => import('@/features/docker/pages/docker-repositories-page'));
const DockerRepositoryDetailPage = lazy(() => import('@/features/docker/pages/docker-repository-detail-page'));
const DockerTagDetailPage = lazy(() => import('@/features/docker/pages/docker-tag-detail-page'));
const NuGetPackagesPage = lazy(() => import('@/features/nuget/pages/nuget-packages-page'));
const NuGetPackageDetailPage = lazy(() => import('@/features/nuget/pages/nuget-package-detail-page'));
const NuGetVersionDetailPage = lazy(() => import('@/features/nuget/pages/nuget-version-detail-page'));
const NpmPackagesPage = lazy(() => import('@/features/npm/pages/npm-packages-page'));
const NpmPackageDetailPage = lazy(() => import('@/features/npm/pages/npm-package-detail-page'));
const NpmVersionDetailPage = lazy(() => import('@/features/npm/pages/npm-version-detail-page'));
const UsersPage = lazy(() => import('@/features/rbac/pages/users-page'));
const UserDetailPage = lazy(() => import('@/features/rbac/pages/user-detail-page'));
const TeamsPage = lazy(() => import('@/features/rbac/pages/teams-page'));
const TeamDetailPage = lazy(() => import('@/features/rbac/pages/team-detail-page'));
const RolesPage = lazy(() => import('@/features/rbac/pages/roles-page'));
const AuditLogsPage = lazy(() => import('@/features/audit-logs/pages/audit-logs-page'));
const AnalyticsPage = lazy(() => import('@/features/analytics/pages/analytics-page'));
const SettingsPage = lazy(() => import('@/features/settings/pages/settings-page'));
const GeneralSettingsForm = lazy(() => import('@/features/settings/components/general-settings-form'));
const RegistryConnections = lazy(() => import('@/features/settings/components/registry-connections'));
const StorageSettings = lazy(() => import('@/features/settings/components/storage-settings'));
const RetentionPolicies = lazy(() => import('@/features/settings/components/retention-policies'));
const WebhooksList = lazy(() => import('@/features/settings/components/webhooks-list'));
const CredentialsManagement = lazy(() => import('@/features/settings/components/credentials-management'));
const LoginPage = lazy(() => import('@/features/auth/pages/login-page'));
const RegistryPage = lazy(() => import('@/features/registry/pages/registry-page'));

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
      {children}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LazyPage><LoginPage /></LazyPage>,
  },
  {
    element: <AuthGuard><AppLayout /></AuthGuard>,
    children: [
      { index: true, element: <LazyPage><DashboardPage /></LazyPage> },
      { path: 'docker', element: <LazyPage><DockerRepositoriesPage /></LazyPage> },
      { path: 'docker/:repositoryId', element: <LazyPage><DockerRepositoryDetailPage /></LazyPage> },
      { path: 'docker/:repositoryId/tags/:tagName', element: <LazyPage><DockerTagDetailPage /></LazyPage> },
      { path: 'nuget', element: <LazyPage><NuGetPackagesPage /></LazyPage> },
      { path: 'nuget/:packageId', element: <LazyPage><NuGetPackageDetailPage /></LazyPage> },
      { path: 'nuget/:packageId/versions/:version', element: <LazyPage><NuGetVersionDetailPage /></LazyPage> },
      { path: 'npm', element: <LazyPage><NpmPackagesPage /></LazyPage> },
      { path: 'npm/:packageName', element: <LazyPage><NpmPackageDetailPage /></LazyPage> },
      { path: 'npm/:packageName/versions/:version', element: <LazyPage><NpmVersionDetailPage /></LazyPage> },
      // Registry-scoped routes (multiple registries of same kind)
      { path: 'registry/:connectionId', element: <LazyPage><RegistryPage /></LazyPage> },
      { path: 'registry/:connectionId/docker/:repositoryId', element: <LazyPage><DockerRepositoryDetailPage /></LazyPage> },
      { path: 'registry/:connectionId/docker/:repositoryId/tags/:tagName', element: <LazyPage><DockerTagDetailPage /></LazyPage> },
      { path: 'registry/:connectionId/nuget/:packageId', element: <LazyPage><NuGetPackageDetailPage /></LazyPage> },
      { path: 'registry/:connectionId/nuget/:packageId/versions/:version', element: <LazyPage><NuGetVersionDetailPage /></LazyPage> },
      { path: 'registry/:connectionId/npm/:packageName', element: <LazyPage><NpmPackageDetailPage /></LazyPage> },
      { path: 'registry/:connectionId/npm/:packageName/versions/:version', element: <LazyPage><NpmVersionDetailPage /></LazyPage> },
      { path: 'access/users', element: <LazyPage><UsersPage /></LazyPage> },
      { path: 'access/users/:userId', element: <LazyPage><UserDetailPage /></LazyPage> },
      { path: 'access/teams', element: <LazyPage><TeamsPage /></LazyPage> },
      { path: 'access/teams/:teamId', element: <LazyPage><TeamDetailPage /></LazyPage> },
      { path: 'access/roles', element: <LazyPage><RolesPage /></LazyPage> },
      { path: 'audit-logs', element: <LazyPage><AuditLogsPage /></LazyPage> },
      { path: 'analytics', element: <LazyPage><AnalyticsPage /></LazyPage> },
      {
        path: 'settings',
        element: <LazyPage><SettingsPage /></LazyPage>,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: 'general', element: <LazyPage><GeneralSettingsForm /></LazyPage> },
          { path: 'registries', element: <LazyPage><RegistryConnections /></LazyPage> },
          { path: 'credentials', element: <LazyPage><CredentialsManagement /></LazyPage> },
          { path: 'storage', element: <LazyPage><StorageSettings /></LazyPage> },
          { path: 'retention', element: <LazyPage><RetentionPolicies /></LazyPage> },
          { path: 'webhooks', element: <LazyPage><WebhooksList /></LazyPage> },
        ],
      },
    ],
  },
]);

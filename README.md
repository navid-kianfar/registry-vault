<p align="center">
  <img src="https://img.shields.io/badge/RegistryVault-Private%20Registry%20Manager-blue?style=for-the-badge" alt="RegistryVault" />
</p>

<h1 align="center">RegistryVault</h1>

<p align="center">
  A modern, open-source management panel for private Docker, NuGet, and NPM registries.<br />
  Built with React, TypeScript, and shadcn/ui.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---

## Overview

RegistryVault provides a unified management interface for your private package registries. Monitor Docker images, NuGet packages, and NPM modules from a single dashboard with real-time analytics, role-based access control, and comprehensive audit logging.

### Key Features

- **Multi-Registry Support** - Manage Docker, NuGet, and NPM registries from one panel
- **Interactive Dashboard** - Real-time stats, pull/push charts, storage breakdown, and health monitoring
- **Docker Registry** - Browse repositories, view tags, inspect image layers, and track vulnerabilities
- **NuGet Registry** - Explore packages, versions, dependency trees, and install commands
- **NPM Registry** - Package browsing with readme rendering, dependency inspection, and dist-tags
- **Role-Based Access Control** - Users, teams, and fine-grained role/permission management
- **Audit Logs** - Filterable activity log with action tracking, user attribution, and IP logging
- **Analytics** - Pull/push trends, registry comparisons, and top package rankings
- **Settings** - Instance configuration, registry connections, retention policies, and webhooks
- **Dark Mode** - Full light/dark/system theme support
- **Responsive** - Mobile-friendly with collapsible sidebar navigation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript 5.7 |
| **Build** | Vite 6 with SWC |
| **Styling** | Tailwind CSS 3.4 + shadcn/ui (Radix UI primitives) |
| **State** | TanStack React Query v5 |
| **Charts** | Recharts 2.x via shadcn/ui Chart component |
| **Routing** | React Router v7 |
| **Icons** | Lucide React |
| **Monorepo** | pnpm workspaces |

## Project Structure

```
registryvault/
├── apps/web/                     # Vite React application
│   └── src/
│       ├── components/
│       │   ├── ui/               # shadcn/ui primitives (25+ components)
│       │   ├── layout/           # AppLayout, Sidebar, Topbar, Breadcrumbs
│       │   ├── data-table/       # Pagination component
│       │   ├── charts/           # Chart wrapper cards
│       │   └── shared/           # StatCard, CopyCommand, RegistryBadge, etc.
│       ├── features/
│       │   ├── dashboard/        # Overview with stats & charts
│       │   ├── docker/           # Docker registry pages
│       │   ├── nuget/            # NuGet registry pages
│       │   ├── npm/              # NPM registry pages
│       │   ├── rbac/             # Users, Teams, Roles pages
│       │   ├── audit-logs/       # Filterable audit log
│       │   ├── analytics/        # Pull/push analytics
│       │   └── settings/         # Settings with sub-navigation
│       ├── services/
│       │   ├── api-client.ts     # IApiClient interface
│       │   ├── mock/             # MockApiClient + mock data
│       │   └── queries/          # React Query hooks per feature
│       ├── providers/            # Theme, Query, Sidebar providers
│       ├── router/               # Routes + lazy loading
│       ├── hooks/                # Custom hooks
│       ├── lib/                  # Utils, formatters
│       └── styles/               # Global CSS with theme variables
├── packages/shared/              # @registryvault/shared
│   └── src/
│       ├── enums/                # Numeric enums (RegistryType, Role, Permission, etc.)
│       ├── interfaces/           # All data interfaces
│       ├── types/                # API response types, filters, pagination
│       └── constants/            # Registry labels, role definitions, pagination
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Getting Started

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/registryvault.git
cd registryvault

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The app will be available at `http://localhost:3000`.

### Build for Production

```bash
pnpm build
```

The build output will be in `apps/web/dist/`.

## Architecture

### Mock Data Service Layer

The frontend uses a service abstraction layer that makes it easy to swap mock data for a real backend:

```
React Components
    → React Query Hooks
        → IApiClient Interface
            → MockApiClient (current)
            → RealApiClient (future)
```

The `IApiClient` interface defines every API operation. The `MockApiClient` implements it with in-memory data and simulated delays. When the backend is ready, simply create a new class implementing `IApiClient` — no component changes needed.

### Shared Package

The `@registryvault/shared` package contains all TypeScript types, interfaces, and constants shared between frontend and future backend:

- **Numeric Enums**: `RegistryType`, `Role`, `Permission`, `AuditAction`, `HealthStatus`, `VulnerabilitySeverity`, `StorageBackend`, `WebhookEvent`
- **Interfaces**: Data models for all entities (Docker, NuGet, NPM, RBAC, audit logs, analytics, settings)
- **Types**: `ApiResponse<T>`, `PaginatedResponse<T>`, filter types
- **Constants**: Registry labels/colors, role definitions, pagination defaults

### Design Principles

- **Card/Row Layouts** - Interactive rows with icons, badges, and actions instead of traditional tables
- **Registry Color Coding** - Docker (#2496ED), NuGet (#7B3FBF), NPM (#CB3837)
- **Skeleton Loading** - Every page has loading skeletons for smooth UX
- **Empty States** - Meaningful empty state components for all list pages
- **Mobile First** - Responsive layout with collapsible sidebar and adaptive grids

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | Stats, charts, health, activity feed |
| Docker Repositories | `/docker` | Repository list with search |
| Docker Repository Detail | `/docker/:id` | Tags list with vulnerability badges |
| Docker Tag Detail | `/docker/:id/tags/:tag` | Layers, metadata, vulnerabilities |
| NuGet Packages | `/nuget` | Package list with search |
| NuGet Package Detail | `/nuget/:id` | Versions, dependencies |
| NuGet Version Detail | `/nuget/:id/versions/:v` | Version metadata, deps |
| NPM Packages | `/npm` | Package list with search |
| NPM Package Detail | `/npm/:name` | Readme, versions, deps |
| NPM Version Detail | `/npm/:name/versions/:v` | Version metadata, deps |
| Users | `/access/users` | User management |
| User Detail | `/access/users/:id` | Profile, teams, permissions |
| Teams | `/access/teams` | Team cards |
| Team Detail | `/access/teams/:id` | Members, description |
| Roles | `/access/roles` | Role definitions & permissions |
| Audit Logs | `/audit-logs` | Filterable activity log |
| Analytics | `/analytics` | Trends, comparisons, top packages |
| Settings | `/settings/*` | General, registries, storage, retention, webhooks |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm type-check` | Run TypeScript type checking |
| `pnpm clean` | Remove build artifacts |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

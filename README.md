<p align="center">
  <img src="apps/web/public/registryvault-logo.svg" width="80" alt="Registry Vault" />
</p>

<h1 align="center">Registry Vault</h1>

<p align="center">
  A self-hosted management panel for private Docker, NuGet, and NPM registries.<br />
  Browse, manage, and clean up images and packages from a single unified UI.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---
Repository manager:
![Screenshot](screenshots/docker-1.png)

Docker images:
![Screenshot](screenshots/docker-2.png)

Nuget packages:
![Screenshot](screenshots/nuget-1.png)

more screenshots are available in screenshots folder

## Overview

Registry Vault connects to your existing private registries and gives you a clean UI to:

- **Browse** Docker repositories, image tags, NuGet packages, and NPM modules
- **Delete** individual images/versions or bulk-clean by age or count
- **Monitor** storage usage, registry health, and pull/push activity
- **Manage** users, teams, roles, and access permissions
- **Automate** cleanup via retention policies with manual or scheduled runs
- **Audit** every action with a filterable, timestamped audit log

> Registry Vault manages and removes artifacts — it does **not** push to registries.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **API** | NestJS 10 + TypeORM (SQLite by default) |
| **Frontend** | React 19 + TypeScript 5.7 + Vite 6 (SWC) |
| **Styling** | Tailwind CSS 3.4 + shadcn/ui (Radix UI) |
| **State / Data** | TanStack React Query v5 |
| **Routing** | React Router v7 |
| **Charts** | Recharts 2.x |
| **Auth** | JWT (Bearer token, stored in localStorage) |
| **PWA** | vite-plugin-pwa — offline support + auto-update banner |
| **Monorepo** | pnpm workspaces |

---

## Project Structure

```
repo-station/
├── apps/
│   ├── api/                    # NestJS backend
│   │   └── src/
│   │       ├── auth/           # JWT login/logout, current user
│   │       ├── dashboard/      # Stats and activity feed
│   │       ├── docker/         # Docker repository and tag management
│   │       ├── nuget/          # NuGet package management
│   │       ├── npm/            # NPM package management
│   │       ├── rbac/           # Users, teams, roles
│   │       ├── audit-logs/     # Audit log records
│   │       ├── analytics/      # Pull/push trend data
│   │       ├── bulk/           # Bulk delete and cleanup operations
│   │       └── settings/       # Connections, credentials, policies, webhooks
│   └── web/                    # React/Vite frontend (PWA)
│       └── src/
│           ├── components/
│           │   ├── ui/         # shadcn/ui primitives
│           │   ├── layout/     # AppLayout, Sidebar, Topbar, Breadcrumbs
│           │   └── shared/     # StatCard, RegistryBadge, EmptyState, etc.
│           ├── features/
│           │   ├── dashboard/
│           │   ├── docker/
│           │   ├── nuget/
│           │   ├── npm/
│           │   ├── rbac/
│           │   ├── audit-logs/
│           │   ├── analytics/
│           │   └── settings/
│           ├── services/
│           │   ├── api-client.ts       # IApiClient interface
│           │   ├── http-api-client.ts  # Fetch-based implementation
│           │   └── queries/            # React Query hooks per feature
│           └── providers/              # Auth, Theme, Sidebar, QueryClient
└── packages/
    └── shared/                 # @registry-vault/shared (types shared by API + Web)
        └── src/
            ├── enums/          # RegistryType, Role, Permission, AuditAction, …
            ├── interfaces/     # All data models
            ├── types/          # ApiResponse<T>, PaginatedResponse<T>, filters
            └── constants/      # Registry labels, pagination defaults
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9

### Development

```bash
# Clone
git clone <repo-url>
cd repo-station

# Install dependencies
pnpm install

# Configure environment — set JWT_SECRET and ADMIN_PASSWORD (both required)
cp .env.example apps/api/.env

# Start the API (port 3001)
pnpm dev

# In a second terminal, start the frontend (port 3000)
pnpm dev:web
```

- Frontend: `http://localhost:3000`
- API: `http://localhost:3001`

The frontend proxies `/api/*` requests to the API during development.

### Initial admin account

There are no hardcoded default credentials. On first start (empty database) the API creates a single admin account from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USERNAME` | `admin` | Username for the initial admin account |
| `ADMIN_PASSWORD` | — **required on first start** | The API refuses to start with an empty database if unset |
| `ADMIN_EMAIL` | `admin@registryvault.local` | Email for the initial admin account |

Once any user exists these variables are ignored — manage users from the UI.

```bash
docker run -e JWT_SECRET=... -e ADMIN_PASSWORD=... \
  -v registry-vault-data:/app/data -p 80:80 kianfar/registry-vault
```

### Build for Production

```bash
pnpm build
```

Frontend output: `apps/web/dist/`
API output: `apps/api/dist/`

### Docker

#### Using Docker Compose (Recommended)

The easiest way to run Registry Vault is with Docker Compose:

```bash
cp .env.example .env   # then set JWT_SECRET and ADMIN_PASSWORD
docker compose up -d
```

This uses the `docker-compose.yml` file, which stores the database in a Docker **named volume** (`registry-vault-data`) and reads configuration from `.env`. The volume is managed by Docker and survives `docker compose down` and container recreation — it is only removed if you explicitly ask for it with `docker compose down -v`.

#### Using Docker Image directly

You can run Registry Vault using the pre-built Docker image with all configuration passed inline — no `.env` file needed:

```bash
docker run -d \
  --name registry-vault \
  -p 8080:80 \
  -v registry-vault-data:/app/data \
  -e JWT_SECRET=change-me-to-a-long-random-string \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=choose-a-strong-password \
  kianfar/registry-vault
```

Then open `http://localhost:8080` and sign in with the admin credentials you set. Generate a strong `JWT_SECRET` with `openssl rand -base64 48`. The named volume `registry-vault-data` keeps the SQLite database and the auto-generated credential encryption key, so they survive container recreation (Docker creates the volume on first run). `ADMIN_USERNAME` / `ADMIN_PASSWORD` only matter on the very first start (empty database) — see [Configuration](#configuration) for all variables.

If you prefer a file, the same variables can come from `.env`:

```bash
docker run -d --name registry-vault -p 8080:80 -v registry-vault-data:/app/data \
  --env-file .env kianfar/registry-vault
```

#### Build locally

If you prefer to build the image yourself:

```bash
docker build -t registry-vault .
docker run --env-file .env -p 80:80 -v registry-vault-data:/app/data registry-vault
```

The container exposes port **80** and listens on `0.0.0.0`.

Configuration is supplied at run time only. No env file is copied into the image — `.dockerignore` keeps every env file (including `.env.example`) out of the build context, and because the image sets `NODE_ENV=production` the API ignores on-disk env files and reads configuration solely from the process environment. `--env-file` works because Docker reads the file on the *host* and injects the values as environment variables. Never bake secrets into an image layer.

#### Managing the data volume

The database, and the credential encryption key when it is auto-generated, live in the `registry-vault-data` volume. With Docker Compose the volume is prefixed with the project name — `registry-vault_registry-vault-data` when you run compose from a directory named `registry-vault`; run `docker volume ls` to confirm, and substitute that name below.

```bash
docker volume inspect registry-vault-data          # where Docker stores it
docker run --rm -v registry-vault-data:/data -v "$(pwd):/backup" alpine \
  tar czf /backup/registry-vault-backup.tar.gz -C /data .   # back up
docker volume rm registry-vault-data               # delete — wipes all data
```

> Removing the volume resets the instance to an empty database, so the next start re-runs the initial admin seed from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

If you are migrating from an older setup that bind-mounted `./data`, copy the existing files into the named volume before starting:

```bash
docker run --rm -v "$(pwd)/data:/from" -v registry-vault-data:/to alpine \
  sh -c "cp -a /from/. /to/"
```

---

## Configuration

The API reads environment variables at startup. [`.env.example`](.env.example) documents every variable — copy it to `.env` (Docker) or `apps/api/.env` (local development) to get started.

In Docker the `.env` file stays on the host: Docker reads it and passes the values in as environment variables. The API only loads a `.env` file from disk outside production (`NODE_ENV !== 'production'`), which is the local development path.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` (Docker image: `80`) | API listen port |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin for browser requests |
| `JWT_SECRET` | — **required** | Secret for signing JWT tokens; the API refuses to start without it |
| `ADMIN_USERNAME` | `admin` | Username for the initial admin account (first start only) |
| `ADMIN_PASSWORD` | — **required on first start** | Password for the initial admin account, created when the database is empty |
| `ADMIN_EMAIL` | `admin@registryvault.local` | Email for the initial admin account (first start only) |
| `ENCRYPTION_KEY` | auto-generated | Key for encrypting stored registry credentials; auto-generated at `<data dir>/.encryption-key` when unset (set explicitly for PostgreSQL) |
| `DB_TYPE` | `sqlite` | Database backend: `sqlite` or `postgres` |
| `DB_PATH` | `./data/registry-vault.db` | SQLite database file path (when `DB_TYPE=sqlite`) |
| `DB_HOST` | `localhost` | PostgreSQL host (when `DB_TYPE=postgres`) |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DB_NAME` | `registryvault` | PostgreSQL database name |

> PostgreSQL support requires the `pg` driver, which is not installed by default:
> `pnpm --filter @registry-vault/api add pg`

---

## Features

### Registry Management
- Add registry connections with custom endpoints (Docker, NuGet, NPM)
- Browse repositories and packages per registry
- View detailed tag / version metadata

### Cleanup & Retention
- **Bulk delete** selected tags or package versions
- **Cleanup**: keep N latest versions or delete versions older than N days
- **Retention policies**: define rules per registry type, enable/disable, run on demand

### User & Access Management
- Create, edit, deactivate, and delete users
- Admin password reset (no current password required)
- Teams with member management
- Role-based permissions (Admin / Maintainer / Reader)

### Settings
| Tab | Functionality |
|-----|--------------|
| General | Instance name (shown in sidebar), self-registration toggle, maintenance mode banner |
| Registries | Add / edit / delete registry connections with custom URLs |
| Credentials | Store auth credentials per registry connection |
| Retention | Create / edit / delete policies, toggle enable, run immediately |
| Webhooks | Add / edit / delete webhooks with event and registry filters |

### PWA
The frontend is a Progressive Web App — installable, works offline with cached assets, and shows an update banner when a new version is deployed.

---

## API Endpoints

All endpoints are prefixed with `/api`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Authenticate and receive JWT |
| GET | `/auth/me` | Current user profile |
| GET | `/dashboard/stats` | Aggregated stats |
| GET | `/dashboard/activity` | Recent activity feed |
| GET/POST/DELETE | `/docker/repositories` | Docker repository management |
| GET/DELETE | `/docker/repositories/:id/tags/:tag` | Tag operations |
| GET/POST/DELETE | `/nuget/packages` | NuGet package management |
| GET/POST/DELETE | `/npm/packages` | NPM package management |
| GET/POST/PATCH/DELETE | `/users` | User CRUD |
| PATCH | `/users/:id/password` | Change / reset password |
| GET/POST/PATCH/DELETE | `/teams` | Team CRUD |
| GET | `/audit-logs` | Filterable audit log |
| GET | `/analytics/summary` | Pull/push trend data |
| GET/POST/PATCH/DELETE | `/settings/registries` | Registry connection CRUD |
| GET/POST/PATCH/DELETE | `/settings/retention` | Retention policy CRUD |
| POST | `/settings/retention/:id/run` | Run policy immediately |
| GET/POST/PATCH/DELETE | `/settings/webhooks` | Webhook CRUD |
| POST | `/bulk/delete` | Bulk delete items |
| POST | `/bulk/cleanup` | Cleanup versions by count or age |

---

## Pages

| Page | Route |
|------|-------|
| Dashboard | `/` |
| Docker Repositories | `/registry/:id/docker` |
| Docker Repository Detail | `/registry/:id/docker/:repoId` |
| NuGet Packages | `/registry/:id/nuget` |
| NuGet Package Detail | `/registry/:id/nuget/:packageId` |
| NPM Packages | `/registry/:id/npm` |
| NPM Package Detail | `/registry/:id/npm/:name` |
| Users | `/access/users` |
| User Detail | `/access/users/:userId` |
| Teams | `/access/teams` |
| Team Detail | `/access/teams/:teamId` |
| Roles | `/access/roles` |
| Audit Logs | `/audit-logs` |
| Analytics | `/analytics` |
| Settings | `/settings/general`, `/settings/registries`, `/settings/credentials`, `/settings/retention`, `/settings/webhooks` |

---

## License

MIT — see [LICENSE](LICENSE) for details.

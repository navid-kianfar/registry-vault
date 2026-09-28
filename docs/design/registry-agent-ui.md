# Registry agent — UI specification

Design spec for the web UI of the Go **registry agent**. Written against the code on
`feature/registry-agent` as it stands: every component path, token and pattern named below was
read in the repository, and the rendered look was checked against `screenshots/docker-2.png` and
`screenshots/docker-3.png`. Anything I could not verify is marked **(unverified)**.

Implementation target: `apps/web` (React + Vite + Tailwind + shadcn/ui). No new design system, no
new dependency: four new shared components, six new CSS variables, everything else built from the
primitives already in `components/ui/`.

Contracts this spec is built on:

- `packages/shared/src/interfaces/agent.interfaces.ts` (types + Vault route comments)
- `agent/API.md` (agent behaviour)
- the new fields in `settings.interfaces.ts`, `docker.interfaces.ts`, `bulk-operations.interfaces.ts`

---

## 1. Decisions taken up front

These are the choices an implementer would otherwise have to guess at. Each says what it was
chosen over.

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | Maintenance is a **page per connection** at `/registry/:connectionId/maintenance`, reached from a tab strip on the registry page | A Settings sub-page — Settings is where you *configure* the agent; maintenance is a daily operation that belongs next to the repositories it affects. A modal — it holds eight sections, live state and a log viewer; it must be linkable and refreshable. |
| D2 | Registry users is a **sibling page** `/registry/:connectionId/users`, not a section of the maintenance page | Folding it into maintenance — these are credentials, a different job with a different audience, and they need their own URL to link a colleague to. |
| D3 | The tab strip is rendered by each of the three pages as a shared component, **not** a router layout with `<Outlet/>` | Converting `registry/:connectionId` into a layout route — the docker/nuget/npm detail routes are siblings of it today (`routes.tsx:57-63`); restructuring them risks breaking working navigation for zero visible gain. |
| D4 | **Embedded** connection: URL, agent URL and agent API key are read-only; delete is **hidden**, not disabled; name and "default" stay editable | Allowing edits that silently revert on the next boot (the values come from the container's env), or hiding the whole row — the operator needs to see the registry they are running. |
| D5 | In-page sections for an **absent agent feature** stay visible with a one-line explanation; **navigation** (tabs) only shows destinations that work | Hiding sections — an operator on a maintenance page is there to learn what this registry can do, and a silently missing GC card reads as a bug. Conversely a tab that only says "not available" is a dead end. |
| D6 | Write actions are **admin-only, rendered disabled** with a tooltip, not hidden | Hiding them — a non-admin then cannot tell the capability exists, and files a ticket instead of asking for the role. Secrets (API key field, one-time password) *are* hidden, since there is nothing to disable. |
| D7 | Severity colour becomes **five CSS variables + one `SeverityBadge`**; the two existing literal-colour call sites migrate to it | A third copy of `bg-red-500/15 text-red-600 …`. The two existing copies have already drifted (`text-yellow-700` in the list vs `bg-yellow-500` on the detail page) and neither is legible in dark mode. |
| D8 | One new shared `Notice` component covers the nine banner states | Nine ad-hoc `rounded-lg border border-amber-500/20 …` divs, which is what `docker-tag-detail-page.tsx:76` and `app-layout.tsx:16` already are. |

---

## 2. Navigation and route map

### 2.1 Routes to add

`apps/web/src/router/route-paths.ts`:

```ts
REGISTRY_MAINTENANCE: '/registry/:connectionId/maintenance',
REGISTRY_USERS:       '/registry/:connectionId/users',
```

`apps/web/src/router/routes.tsx` — two new siblings inside the `AppLayout` children, directly
after the existing `registry/:connectionId` entry:

```tsx
{ path: 'registry/:connectionId/maintenance', element: <LazyPage><RegistryMaintenancePage /></LazyPage> },
{ path: 'registry/:connectionId/users',       element: <LazyPage><RegistryUsersPage /></LazyPage> },
```

Order matters: both must come **before** `registry/:connectionId/docker/:repositoryId` is
irrelevant (different second segment), but keep them adjacent for readability.

### 2.2 How each surface is reached

```
Sidebar → Registries → Docker (1) → "Achasoft Docker"      → /registry/:id
                                     status dot on the name when something is wrong
                                         ↓ tab strip
   [ Repositories ] [ Maintenance ] [ Registry users ]
          │                │                │
   /registry/:id   …/maintenance      …/users

Settings → Registries → connection row → [Maintenance] link button  → …/maintenance
Dashboard → "Registry agents" card → row chevron                    → …/maintenance
Docker repository detail → GC-running notice → "View maintenance"   → …/maintenance
```

**Sidebar (`components/layout/sidebar.tsx`)** — do **not** add child links per connection; the
tree is already three levels deep. Add only a status dot after the connection name inside
`RegistryTypeGroup`'s connection `<Link>`, and only when there is something to report. The data
is already in `useRegistryConnections()` (`connection.agent`), so this costs no request.

```tsx
// shown only when conn.agent && (status !== 'online' || lowDisk-ish condition)
<span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--severity-high))]"
      aria-hidden="true" />
```

The dot is decoration only — it must never be the sole carrier of meaning. Give the `<Link>` an
`aria-label={`${conn.name} — agent offline`}` when the dot is shown, and a `Tooltip` with the same
text. Collapsed sidebar: the existing tooltip list gains " — agent offline" after the name.

Conditions for the dot, in priority order: `status !== 'online'` → offline/unauthorized (use
`--severity-high`); else `maintenance.readOnly` → read-only (use `--severity-medium`); else
`lowDisk` → low disk (use `--severity-medium`). Sourced from the dashboard agents-overview query
if it is already in cache, otherwise from `connection.agent.status` alone (which is all the
connection list carries). **Keep it to `connection.agent.status` only** if the overview query is
not already mounted — do not fire an extra request from the sidebar.

### 2.3 Tab strip

New component: `apps/web/src/features/registry/components/registry-tabs.tsx`.

Reuses the exact visual pattern of `features/settings/pages/settings-page.tsx` (underline tabs),
with the horizontal-overflow fix that page is missing:

```tsx
<div className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0">
  {tabs.map(t => (
    <Link key={t.path} to={t.path}
      className={cn(
        'whitespace-nowrap border-b-2 -mb-px px-4 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive ? 'border-primary text-primary'
                 : 'border-transparent text-muted-foreground hover:text-foreground')}
      aria-current={isActive ? 'page' : undefined}>
      {t.label}
    </Link>
  ))}
</div>
```

Tabs, in order, and when each appears:

| Tab | Path | Shown when |
|---|---|---|
| Repositories | `/registry/:id` | always |
| Maintenance | `…/maintenance` | `connection.registryType === Docker && connection.agent` |
| Registry users | `…/users` | the above **and** `agent.features.includes('users')` |

When only "Repositories" would show, render **nothing** — a one-tab strip is noise, and NuGet/NPM
registry pages must look exactly as they do today.

### 2.4 Breadcrumbs

`components/layout/breadcrumbs.tsx`, `staticLabels`: add `maintenance: 'Maintenance'`.

`users` already maps to `'Users'`, which inside `/registry/:id/users` reads as the Vault users
page. Add a context override in `resolveLabel`:

```ts
if (segment === 'users' && segments[0] === 'registry') return 'Registry users';
```

Both new segments go in `alwaysNonNavigable`? No — they are the last segment in their own URL, so
`isLast` already renders them as plain text. No change needed there.

---

## 3. New design-system pieces

### 3.1 Severity tokens (new)

Add to `apps/web/src/styles/globals.css`, in the same block as the existing `--docker / --nuget /
--npm` product tokens — that block is the app's established place for semantic colour, so this is
an extension of the existing scale, not a new system.

```css
:root {
  /* Vulnerability severity — see the contrast rule below before changing a number */
  --severity-critical: 0 72% 45%;
  --severity-high:     21 90% 38%;
  --severity-medium:   35 92% 31%;
  --severity-low:      221 83% 45%;
  --severity-unknown:  215 16% 44%;
  --severity-none:     160 84% 26%;   /* "Clean" */
}
.dark {
  --severity-critical: 0 84% 65%;
  --severity-high:     27 96% 61%;
  --severity-medium:   43 96% 56%;
  --severity-low:      213 94% 68%;
  --severity-unknown:  215 20% 65%;
  --severity-none:     158 64% 52%;
}
```

**Intent, so the values survive a rebrand.** Each token is the lightness at which that hue clears
**4.5:1 in the worst case it is actually used in** — which is not the plain background but the
badge: the same colour as text on a 10% tint of itself. That tint *lowers* contrast, by roughly
0.7 of a ratio point, so a value picked against white alone will fail on the badge. Every value
below was computed, not eyeballed:

| token | light on `--background` | light on its 10% tint | dark on `--background` | dark on tint |
|---|---|---|---|---|
| critical | 5.81 | **4.94** | 6.06 | 5.59 |
| high | 5.33 | **4.62** | 8.83 | 7.89 |
| medium | 5.47 | **4.78** | 11.83 | 10.27 |
| low | 6.77 | **5.79** | 7.92 | 7.03 |
| unknown | 5.25 | **4.62** | 7.78 | 6.92 |
| none | 5.35 | **4.65** | 10.41 | 9.07 |

Computed against `--background: 0 0% 100%` and `222.2 84% 4.9%` as they stand in `globals.css`.
If either background changes, recompute these — do not nudge them by eye.

Hue choices deliberately match what is on screen today (red / orange / amber / blue / emerald) so
nothing visually jumps; only the lightness moves, and only where the current colours were
illegible. Note `--severity-unknown` is close to but **not** `--muted-foreground`
(`215.4 16.3% 46.9%`), which fails on its own tint — do not "simplify" it to `var(--muted-foreground)`.

**This changes everywhere.** The two existing call sites must migrate in the same PR:

- `features/docker/pages/docker-repository-detail-page.tsx:32-53` — `VulnBadges` is replaced by
  `SeverityBadge` (§3.3).
- `features/docker/pages/docker-tag-detail-page.tsx:118-133` — the four progress bars use
  `bg-[hsl(var(--severity-*))]` for the fill and `/20` for the track.

### 3.2 New shadcn primitives: none

Every primitive this spec needs is already in `components/ui/`: `card`, `badge`, `button`,
`dialog`, `input`, `label`, `select`, `switch`, `textarea`, `checkbox`, `table`, `tabs`,
`collapsible`, `tooltip`, `popover`, `scroll-area`, `separator`, `skeleton`, `chart`, `sonner`.

Explicitly **not** adding, and why:

- **`progress`** — the obvious pick for the disk bars, and it was in an earlier draft of this spec.
  Rejected: `@radix-ui/react-progress` is not in `apps/web/package.json`, so it is a new runtime
  dependency bought for three ARIA attributes, on a bar the app already draws by hand in three
  places (`docker-tag-detail-page.tsx:129`, `:185`, and the layer bars). `DiskUsageBar` (§3.3)
  hand-rolls the same markup and sets the ARIA explicitly — same accessibility, no dependency, and
  it matches the bars already on screen.
- **`alert-dialog`** — the app confirms destructive actions with `Dialog` + a `variant="destructive"`
  button (`registry-connections.tsx:496`). Keep that; one confirmation pattern, not two.
- **`radio-group`** — `Tabs` covers the segmented controls (log source, chart range) and gives
  arrow-key navigation.
- **`alert`** — see `Notice` below; the app's banner idiom already differs from shadcn's alert and
  needs an action slot.

### 3.3 New shared components

All in `apps/web/src/components/shared/`, all exported from its `index.ts`.

#### `notice.tsx`

```tsx
interface NoticeProps {
  tone?: 'info' | 'warning' | 'danger' | 'success';  // default 'info'
  title?: string;
  children?: ReactNode;      // description
  icon?: ReactNode;          // defaults per tone
  action?: ReactNode;        // one Button, right-aligned on sm+, below on phone
  className?: string;
}
```

Markup follows the banner idiom already in the app
(`docker-tag-detail-page.tsx:76`, `app-layout.tsx:16`):

```
rounded-lg border px-4 py-3 text-sm  +  per tone:
  info     border-border           bg-muted/50        text-foreground      icon Info
  warning  border-[hsl(var(--severity-medium))]/25  bg-[hsl(var(--severity-medium))]/10
           text-foreground   icon AlertTriangle (icon coloured with the token)
  danger   border-destructive/25   bg-destructive/10  text-foreground      icon AlertCircle
  success  border-[hsl(var(--severity-none))]/25 bg-[hsl(var(--severity-none))]/10
           text-foreground   icon CheckCircle2
```

Body text stays `text-foreground` / `text-muted-foreground` — tone lives in the border, tint and
icon, so contrast never depends on the tinted background. Layout:
`flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between`; icon `h-4 w-4 shrink-0
mt-0.5`; title `font-medium`, description `text-muted-foreground` on the line below.

`tone="danger"` gets `role="alert"`; the others get no role (they are static page content).

If you would rather build on shadcn's `alert`, add it and implement `Notice` on top — the props
above are what every screen in this spec calls.

#### `severity-badge.tsx`

```tsx
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown' | 'none';
<SeverityBadge severity={s} count={n} />       // "3 Critical"
<SeverityBadge severity="none" />              // "Clean"
<SeverityBadge severity="critical" compact />  // "3" with an accessible name
```

```tsx
<Badge variant="outline"
  className="border-[hsl(var(--severity-critical))]/25 bg-[hsl(var(--severity-critical))]/10
             text-[hsl(var(--severity-critical))] px-1.5 py-0 text-[10px] font-mono">
```

`compact` renders the number only but keeps `aria-label="3 critical"`. Also exports
`SEVERITY_ORDER = ['critical','high','medium','low','unknown']` and
`severityFromFinding(f: IScanFinding)` (uppercase → lowercase), so sort order is defined once.

#### `agent-status-badge.tsx`

```tsx
<AgentStatusBadge agent={connection.agent} showVersion />
```

| `status` | Badge | Dot token |
|---|---|---|
| `online` | `Agent online` | `--severity-none` |
| `offline` | `Agent offline` | `--severity-high` |
| `unauthorized` | `Agent unauthorized` | `--severity-critical` |
| `undefined` (no agent) | `No agent` (muted outline) | none |

`Badge variant="outline"` with a 6px dot + label; never colour-only. `showVersion` appends
`· v1.0.0` (from `agent.version`) in `text-muted-foreground`. Wrap in a `Tooltip` whose content
lists: URL, registry version, `Last seen <relative>`, and the feature list as small mono chips.

#### `disk-usage-bar.tsx`

```tsx
<DiskUsageBar disk={health.disk} lowDisk={health.lowDisk} showLabels />
```

Markup — the app's existing bar (`docker-tag-detail-page.tsx:129`) with the ARIA it is missing:

```tsx
<div role="progressbar" aria-label="Disk usage"
     aria-valuenow={Math.round(disk.usedPercent)} aria-valuemin={0} aria-valuemax={100}
     aria-valuetext={`${Math.round(disk.usedPercent)}% used, ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`}
     className="h-2 w-full overflow-hidden rounded-full bg-muted">
  <div className={cn('h-2 rounded-full transition-all',
                     lowDisk ? 'bg-[hsl(var(--severity-high))]' : 'bg-primary')}
       style={{ width: `${Math.min(disk.usedPercent, 100)}%` }} />
</div>
```

- `aria-valuetext` is the load-bearing attribute: "78%" alone does not tell an operator whether
  they have 40 GB or 400 MB left.
- `Math.min(…, 100)` guards a `usedPercent` above 100 (possible with reserved blocks on ext4).
- `showLabels` adds a row under the bar, `text-xs`: left `78% used`, right
  `44.1 GB free of 200 GB` (`formatBytes`).
- Height `h-2`, matching the app's existing bars.

---

## 4. Cross-cutting states

Defined once here; every screen below references them by name.

### 4.1 HTTP → state mapping

The Vault relay is documented in `agent.interfaces.ts:1-10`. Map it exactly:

| Response | State | Where the user lands |
|---|---|---|
| `404` from any `/agent/...` route | **NO-AGENT** | agent is not configured on this connection |
| `502 { message }` | **OFFLINE** | agent configured but unreachable; show `message` |
| `agent.status === 'unauthorized'` | **UNAUTHORIZED** | key is wrong |
| feature missing from `agent.features` | **NO-FEATURE** | section stays, explains why |
| `409` from `POST gc` | toast: "Another garbage collection is already running." |
| `409` from `POST registry/restart` | toast: "Cannot restart while garbage collection is running." |
| `409` from `POST users` | inline field error: "That username already exists." |
| GC refused, registry major < 3 | **GC-UNSUPPORTED** (see §6.3.4) |

### 4.2 The state vocabulary

**NO-AGENT** — an `EmptyState` (existing component), not a `Notice`, because it fills a page or a
whole card:

> **icon** `ServerCog`
> **title** No registry agent on this connection
> **description** A registry agent runs next to your Docker registry and unlocks what the
> registry API cannot do on its own: reclaiming disk space with garbage collection, per-repository
> storage figures, pull counts, stale-upload cleanup, read-only mode, logs, `docker login`
> accounts and vulnerability scans.
> **action** `<Button>` **Set up an agent** → `/settings/registries` (and opens the edit dialog
> for this connection via `?edit=<connectionId>`)

When it fills only one card (e.g. Pull activity on a repository page), use the same copy trimmed
to one sentence: *"Pull counts need a registry agent on this connection."* + a text link
**Set up an agent**.

**OFFLINE** — `Notice tone="danger"`:

> **Agent unreachable**
> Registry Vault could not reach the agent at `http://registry:5080`. The registry itself may
> still be serving pulls and pushes — only agent operations are affected.
> *`<server message>`* (mono, `text-xs`, when present)
> **action** `<Button variant="outline">` Retry — calls `refetch()`

**UNAUTHORIZED** — `Notice tone="danger"`:

> **Agent rejected the API key**
> The agent at `http://registry:5080` answered, but the stored key is not accepted. Update the key
> on the connection.
> **action** `<Button variant="outline">` Edit connection → `/settings/registries?edit=<id>`

**NO-FEATURE** — an inline row inside the section's card, not a banner:

```
<div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
  <Info className="h-4 w-4 shrink-0 mt-0.5" /> <span>{reason}</span>
</div>
```

Reasons, exactly:

| Feature | Reason copy |
|---|---|
| `users` | Registry logins are managed elsewhere — this registry runs with `REGISTRY_AUTH=none`, so anyone who can reach it can pull and push. |
| `scan` | Vulnerability scanning is off — Trivy is not installed on the agent host. Set `TRIVY_ENABLED` and install `trivy` to enable it. |
| `gc` | Garbage collection is not available on this agent. |
| `storage` | Storage figures are not available on this agent. |
| `uploads` | Stale-upload cleanup is not available on this agent. |
| `maintenance` | Read-only mode is not available on this agent. |
| `logs` | Log access is not available on this agent. |
| `events` | Pull counts need the agent's event log, which this agent does not expose. |

**LOADING** — `Skeleton` blocks shaped like the content, inside the real card (header included),
following `registry-connections.tsx:195-211`. Never a spinner for card content; the route-level
spinner in `LazyPage` stays as-is.

**ERROR (other)** — `Notice tone="danger"` with the error message and a **Retry** action.

**EMPTY** — `EmptyState`, copy per screen below.

**READ-ONLY (permissions)** — see §5.

**RUNNING (GC)** — `Notice tone="warning"`, shown on the maintenance page, the registry page and
every Docker repository detail page of that connection:

> **Garbage collection is running**
> Pushes to this registry are rejected with `503` until it finishes. Pulls are unaffected.
> **action (off the maintenance page only)** `<Button variant="outline">` View maintenance

**READ-ONLY (registry maintenance mode)** — `Notice tone="warning"`, same three places:

> **This registry is in read-only mode**
> Pushes are rejected with `503`. Reason: *<reason>*. On since <relative>.
> **action (off the maintenance page only)** View maintenance

---

## 5. Permissions

The web app has **no permission gating today** — `useAuth()` exposes `user.role` and nothing reads
it. Introduce the smallest possible thing:

`apps/web/src/hooks/use-is-admin.ts`

```ts
import { Role } from '@registry-vault/shared';
import { useAuth } from '@/providers/auth-provider';
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === Role.Admin;
}
```

Rules:

1. Every agent **write** control (GC run/dry-run, restart, read-only toggle, purge uploads, agent
   settings save, user create/role/reset/delete, scan, delete repository, agent URL/key fields) is
   rendered `disabled` for non-admins, wrapped in a `Tooltip`:
   *"Only administrators can change this."*
   A `disabled` button does not fire pointer events, so the tooltip must wrap a `<span
   tabIndex={0}>` around the button — otherwise the tooltip never opens and the control is
   unexplained.
2. **Hidden, not disabled**, for non-admins: the agent API key input, the one-time password
   reveal, the **Registry users** tab entirely.
3. Reads (health, storage, GC history, logs, uploads list, scan results, pull stats) are visible
   to everyone. Logs can contain request paths but not credentials (`agent/API.md:39` — the key is
   never logged), so Reader access is acceptable. **(unverified — confirm with the backend that no
   log source echoes Basic-auth headers.)**
4. At the top of the maintenance page, non-admins see `Notice tone="info"`:
   *"You have read-only access. Administrators can run garbage collection, change maintenance mode
   and manage registry logins."*

Open question in §14: whether `Role.Maintainer` should get GC and scan.

---

## 6. Screen specs

### 6.1 Settings → Registries

File: `apps/web/src/features/settings/components/registry-connections.tsx`

#### 6.1.1 Connection row

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Docker] Achasoft Docker  [Default] [Embedded] 🔑                                 │
│ ⧉ http://registry:5000   👤 registry-vault                                        │
│ ● Agent online · v1.0.0                              ● Connected  [⟳][🩺][🔧][✎][🗑]│
└──────────────────────────────────────────────────────────────────────────────────┘
```

Changes to the existing row:

- **`Embedded` badge** when `connection.isEmbedded` — `Badge variant="outline"` with text
  `Embedded`, wrapped in a `Tooltip`: *"This registry runs inside the Registry Vault container.
  Its address and agent key come from the container's environment."*
- **Agent line**: new third line, only for Docker connections. Renders `<AgentStatusBadge
  agent={connection.agent} showVersion />`, or, when `connection.agent` is undefined, a muted
  `text-xs` line: *No agent — pull counts, garbage collection and scans are unavailable.*
  with a text-button **Add one** that opens the edit dialog on the agent section.
- **Maintenance button** (`🔧`, `Wrench` icon), before the edit pencil, only when
  `connection.agent` exists. `aria-label="Open maintenance for Achasoft Docker"`, `title` the
  same. Navigates to `/registry/:id/maintenance`.
- **Delete button**: `connection.isEmbedded === true` → render nothing in its place (no ghost, no
  disabled button). Reason: there is no user action that could ever succeed, and a permanently
  disabled destructive control invites clicking.

Icon-only buttons in this row currently carry `title` but no `aria-label`
(`registry-connections.tsx:281-311`) — `title` is not a reliable accessible name. Add `aria-label`
to all of them while you are in the file.

#### 6.1.2 Create / edit dialog — agent section

Appended to the existing dialog, after the Authentication block, **only when `formType ===
RegistryType.Docker`**. `DialogContent` grows from `sm:max-w-md` to `sm:max-w-lg` and gains
`max-h-[85vh] overflow-y-auto` — with the agent block the dialog now exceeds a laptop viewport.

```
────────────────────────────────────────────────
REGISTRY AGENT (OPTIONAL)

Agent URL
[ http://registry:5080                        ]
The agent's management API. It is reached by Registry Vault,
not by your browser, so an internal address is fine.

API Key  (leave blank to keep the current key)
[ ••••••••                                    ]
Stored encrypted. It is never sent back to the browser.

[ Test agent ]   ● Agent online · v1.0.0 · registry 3.0.0
                 gc · storage · repositories · uploads · maintenance
                 · logs · users · events · scan
────────────────────────────────────────────────
```

- Section heading uses the existing idiom:
  `<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Registry agent (optional)</p>`
  inside a `border-t pt-4 space-y-3` block — identical to the Authentication block at line 381.
- `id="agentUrl"` / `id="agentApiKey"`, `type="password"`, `autoComplete="new-password"`.
- **Key label**, matching the app's existing wording at line 421:
  `API Key` + `<span className="text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>`
  — only when `editing && editing.agent`.
- **Removing an agent**: when `editing.agent` exists and the user clears the URL field, show below
  it `Notice tone="warning"` (compact, no title): *"Saving with an empty URL removes the agent from
  this connection. Pull counts and scan results already collected are kept."* Submit sends
  `agentUrl: ''`.
- **Embedded**: both inputs `readOnly` + `disabled`, value shown, with a helper line: *"Set by the
  container's environment (`AGENT_API_KEY`). Change it there and restart."* The **Test agent**
  button stays enabled — testing is read-only and useful.
- **Test agent** button: `variant="outline" size="sm"`, `Stethoscope` icon
  (already imported in this file). Disabled while `!formUrl` or the mutation is pending; label
  becomes `Testing…`.
  - **On create** (`!editing`) the route `POST /api/settings/registries/:id/agent/test` has no id
    yet. Render the button disabled with a `Tooltip`: *"Save the connection first, then test the
    agent."* See open question Q1.
  - Result renders inline to the right (below, at phone width):
    - success → `<AgentStatusBadge>` + registry version + the feature list as mono chips
      (`Badge variant="outline" className="font-mono text-[10px]"`).
    - `502` → `text-sm text-destructive`: *Could not reach the agent — `<message>`*
    - `401` → *The agent rejected this key.*
  - Also fires a toast (§12).
- Validation before enabling **Save**: if `agentApiKey` is non-empty it must be ≥ 16 characters
  (`agent/API.md:39` — the agent refuses to start below that, so a shorter key can never work).
  Inline error: *"The agent requires a key of at least 16 characters."*

#### 6.1.3 Deep link

`?edit=<connectionId>` on `/settings/registries` opens the edit dialog for that connection,
scrolled to the agent section. Every **Set up an agent** action in this spec uses it. Read it with
`useSearchParams()` in an effect and clear the param when the dialog closes.

---

### 6.2 Registry page (`/registry/:connectionId`)

File: `apps/web/src/features/registry/pages/registry-page.tsx`

Two changes only:

1. Render `<RegistryTabs connectionId={connectionId} connection={connection} />` directly above
   the type-specific list (inside `DockerList`, or better: in `RegistryPage` above the `switch`, so
   NuGet/NPM get the "render nothing" branch for free).
2. Above the tabs, render the **RUNNING** and **READ-ONLY** notices for this connection when
   applicable (from `useAgentHealth(connectionId)`, §7.1).

Nothing else on this page changes.

---

### 6.3 Registry maintenance page

File: `apps/web/src/features/registry/pages/registry-maintenance-page.tsx`
Section components: `apps/web/src/features/registry/components/maintenance/*.tsx`

#### Page frame

```
Breadcrumbs: ⌂ › Registries › Achasoft Docker › Maintenance

[ Repositories ] [ Maintenance ] [ Registry users ]

Maintenance                                     ● Agent online · v1.0.0   [ ⟳ Refresh ]
Achasoft Docker — registry agent operations

┌ (notices: read-only / GC running / non-admin read-only) ────────────────────────┐

┌ Overview ───────────────────────────────────────────────────────────────────────┐
┌ Garbage collection ─────────────────────────────────────────────────────────────┐
┌ Storage ────────────────────────────────────────────────────────────────────────┐
┌ Stale uploads ─────────────────┐ ┌ Read-only mode ────────────────────────────┐
┌ Logs ───────────────────────────────────────────────────────────────────────────┐
┌ Agent settings ────────────────┐ ┌ Restart registry ──────────────────────────┐
```

- `PageHeader title="Maintenance" description="<connection.name> — registry agent operations"`
  with `<AgentStatusBadge>` and a **Refresh** button (`RefreshCw`, `variant="outline" size="sm"`)
  as children. Refresh invalidates every `['agent', connectionId, …]` key.
- Outer wrapper `space-y-6`; the two-column rows are `grid gap-4 lg:grid-cols-2`.
- Order is by frequency of use: health first, the headline operation (GC) second, the thing GC
  acts on (storage) third, then the occasional ones, then configuration.
- **NO-AGENT** → the whole page body is the NO-AGENT `EmptyState`, tabs hidden (a user can only
  arrive here by URL).
- **OFFLINE / UNAUTHORIZED** → the notice replaces every section; the Overview card still renders
  with its last known `connection.agent` summary (URL, last seen) so the operator can see *what*
  is unreachable.

#### 6.3.1 Overview

Source: `GET health` → `IAgentHealth`. Poll 15 s (§7.1).

```
┌ Overview ───────────────────────────────────────────────────────────────────────┐
│ Registry          Registry Vault (extra)   Disk                 Maintenance      │
│ ● Running         ● Running                44.1 GB free         Accepting pushes │
│ pid 42 · up 6d    pid 43 · up 6d           [████████░░] 78%     —                │
│ 0 restarts        2 restarts · exit 1                                            │
│                   4 days ago                                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Four tiles, `grid grid-cols-2 gap-4 lg:grid-cols-4` inside one `Card`. Do **not** use `StatCard`
here — these are multi-line status tiles, not single numbers; nesting cards in a card is visual
noise. Each tile: `space-y-1`, label `text-sm font-medium text-muted-foreground`, value row, then
`text-xs text-muted-foreground` detail lines.

| Tile | Content | Rules |
|---|---|---|
| Registry | dot + `Running` / `Stopped`; `pid 42 · up 6d`; `N restarts` | dot `--severity-none` / `--severity-critical`. Uptime from `startedAt` via `formatDistanceToNowStrict`. `restarts === 0` → omit the line. |
| Extra process | same, titled `Registry Vault (extra)` | **Omit the tile entirely** when `health.extra === null`; the grid becomes 3 columns (`lg:grid-cols-3`). |
| Disk | `<DiskUsageBar>` + `44.1 GB free of 200 GB` | `lowDisk` → bar turns `--severity-high` and a `Notice tone="warning"` appears above the card (copy in §6.8). |
| Maintenance | `Accepting pushes` / `Read-only`; reason; `since <relative>` | `readOnly` → dot `--severity-medium`, value text `Read-only`. |

`lastExit` present → a line `exited with code 1, <relative>`, in `text-[hsl(var(--severity-high))]`
when `code !== 0`. A non-zero last exit plus a climbing restart count is the single most useful
signal on this page — do not bury it.

States: LOADING → four `Skeleton className="h-16"` tiles. OFFLINE → notice + a muted line
*Last reached <relative>* from `connection.agent.lastSeenAt`.

#### 6.3.2 Garbage collection

Source: `GET gc` (current/latest job), `GET gc/history` (last 20), `POST gc`.
Feature: `gc`. Poll: 2 s while `queued`/`running`, otherwise off (§7.2).

**Idle, with a previous run:**

```
┌ Garbage collection ─────────────────────────────────────────────────────────────┐
│ Deletes blobs no tag points at any more and returns the space to the disk.       │
│ Pushes are rejected while it runs.                        [Dry run] [Run GC]     │
│                                                                                  │
│ ✓ Last run 2 hours ago — freed 1.2 GB                                            │
│   4,812 blobs and 96 manifests deleted · took 3m 41s · 42.1 GB → 40.9 GB used    │
│                                                                                  │
│ ▸ History (20 runs)                                                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Running:**

```
│ ⟳ Garbage collection is running — started 1m 12s ago                             │
│ ┌ Pushes are paused ───────────────────────────────────────────────────────────┐ │
│ │ Pushes to this registry are rejected with 503 until it finishes. Pulls are   │ │
│ │ unaffected.                                                                   │ │
│ └───────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ output (last 8 lines, mono, 11px) ──────────────────────────────────────────┐  │
│ │ blob eligible for deletion: sha256:9f2a…                                      │ │
│ └───────────────────────────────────────────────────────────────────────────────┘ │
│                                              [Dry run ⃠] [Running…  ⃠]            │
```

Details:

- Card description (always visible, `CardDescription`): *"Deletes blobs that no tag points at any
  more and returns the space to the disk. Deleting a tag only unlinks it — the space comes back
  here."* That last sentence is the one operators need; the app already says a shorter version in
  `reportCleanup` (`bulk-operations.queries.ts:44`).
- **Dry run** — `Button variant="outline"`, `FlaskConical` icon, no confirmation (read-only).
  Running state label `Checking…`.
- **Run garbage collection** — `Button` (default variant, *not* destructive: it deletes nothing a
  user named; it is a maintenance operation with a pause, and the confirm dialog carries the
  weight). Opens the confirm dialog:

  > **Run garbage collection?**
  > While it runs, every push to **Achasoft Docker** is rejected with `503` for about 30 seconds of
  > retry. Pulls keep working. It cannot be cancelled once started, and it may take several minutes
  > on a large registry.
  > [Cancel] [Run garbage collection]

  Confirm button `variant="destructive"` (the dialog is where the risk is stated, so the weight
  belongs on its confirm). Cancel gets `autoFocus`.
- **Running state**: both buttons disabled, the Run button's label becomes `Running…` with
  `<Loader2 className="h-4 w-4 animate-spin" />`, elapsed time ticking from `startedAt` (1 s
  `setInterval`, local — do not poll for a clock). Status line carries `aria-live="polite"` so the
  transition to finished is announced.
- **Output tail**: `job.output.slice(-8)` in
  `rounded-md border bg-muted/50 p-2 font-mono text-[11px] overflow-x-auto`. Shown while running
  and on failure; collapsed behind `▸ Output` (a `Collapsible`) on success.
- **Result, succeeded**: `freedBytes > 0` → `✓ Last run <relative> — freed 1.2 GB` with the
  detail line; `freedBytes === 0` → `✓ Last run <relative> — nothing to free` and the detail line
  drops the byte delta. Icon `CheckCircle2` in `--severity-none`.
- **Result, dry run**: `Dry run <relative> — 1.2 GB can be freed` (`FlaskConical` icon, muted) and
  a follow-on `Button size="sm"` **Run it for real**. `blobsDeleted`/`manifestsDeleted` are worded
  as *would delete* for a dry run.
- **Result, failed**: `Notice tone="danger"`, title `Garbage collection failed`, body `job.error`,
  the output tail, action **Try again**. Add the muted line: *"The write gate is always reopened,
  even after a failure — pushes are working again."* (`agent/API.md:205`.)
- **History**: `Collapsible` (existing primitive), trigger `▸ History (N runs)`. Content is a
  `Table`: When | Type | Result | Freed | Duration.
  - `When` = `formatRelativeTime(startedAt)`, `title={formatDateTime(startedAt)}`.
  - `Type` = `Dry run` / `Full` (`Badge variant="outline"`).
  - `Result` = `Succeeded` / `Failed` badge (`--severity-none` / destructive); `Failed` rows get
    the error in a `Tooltip`.
  - `Freed` = `formatBytes(freedBytes ?? 0)`, right-aligned `tabular-nums`.
  - Empty history → *No previous runs.* (muted row, no `EmptyState` — it is inside a disclosure).
  - Below `md`: hide `Duration`, then `Type`.

##### 6.3.3 GC schedule (inside the same card, below a `Separator`)

Source: `GET settings` / `PUT settings` → `IAgentSettings`. Lives here rather than in Agent
settings because it is the same subject; the operator asking "how do I stop doing this by hand" is
looking at this card.

```
│ ───────────────────────────────────────────────────────────────────────────────── │
│ Schedule                                                                          │
│ Run automatically   [ Off ▾ ]    at  [ 03:00 ▾ ]                                  │
│ ▢ Run garbage collection after a retention policy deletes anything here           │
│                                                            [ Save schedule ]      │
```

- `gcSchedule`: `Select` with `Off` / `Daily` / `Weekly`.
- `gcHour`: `Select` of 24 entries, labelled `00:00 … 23:00`, disabled when schedule is `Off`,
  with the helper *"Server local time."* (`agent.interfaces.ts:213`). Weekly runs on Sunday —
  **(unverified: the interface does not carry a weekday; see Q4.)**
- `gcAfterRetention`: `Switch` + `Label`, helper: *"Retention deletes tags; garbage collection is
  what frees the disk. Turning this on does both in one go."*
- Save is a single `Button size="sm"` for the block, disabled until something changed.
  Toast: `Garbage collection schedule saved`.

#### 6.3.4 GC-UNSUPPORTED

When `agent.registryVersion` major `< 3`: the two run buttons are disabled and the card shows
`Notice tone="warning"`:

> **Garbage collection needs registry 3**
> This registry reports version **2.8.3**. On registry 2, deleting untagged manifests also removes
> platform manifests of images that are still tagged, which breaks them. Upgrade the registry
> image to `registry:3` to enable it.

Parse the major with `Number(registryVersion.split('.')[0])`; if it does not parse, leave the
buttons enabled and let the agent's `409` produce the toast — never disable on a value you could
not read.

#### 6.3.5 Storage

Source: `GET storage?refresh=` → `IAgentStorage`. Feature: `storage`. No polling (it walks the
storage root); fetch on mount, `staleTime: 5 min`.

```
┌ Storage ────────────────────────────────────────────────────────────────────────┐
│ Computed 4 minutes ago                                     [ ⟳ Recompute ]       │
│                                                                                  │
│ Disk        [███████████░░░░] 78%   155.9 GB used · 44.1 GB free of 200 GB       │
│ Registry    40.9 GB total   ·  40.2 GB blobs  ·  712 MB uploads  ·  37 repos     │
│                                                                                  │
│ Repository                    Exclusive ▾   Shared     Layers   Manifests        │
│ achasoft_dynevu_management_api    1.2 GB    240 MB        84          14         │
│ achasoft_dynevu_business_api      1.1 GB    240 MB        81          14         │
│ …                                                                                │
│                                          [ pagination: 25 / 50 / 100 ]           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Recompute** = refetch with `?refresh=true`. `Button variant="outline" size="sm"`, spinner
  while pending, label `Recomputing…`. Helper next to `computedAt`: the agent caches for 60 s.
- **Disk row**: `<DiskUsageBar showLabels />`.
- **Registry row**: four `text-sm` figures separated by `·`; `uploadBytes > 0` makes the uploads
  figure a text-button that scrolls to the Stale uploads card.
- **Table** (`components/ui/table`, not `DataTable` — we need our own sort + pagination):
  - Columns: Repository (mono, truncate, links to `/registry/:id/docker/<repo>` **only if** the
    Vault repository id is known; the agent returns a name, not an id, so by default render plain
    text — see Q3), Exclusive, Shared, Layers, Manifests.
  - Default sort `exclusiveBytes` desc. Sortable headers via
    `components/data-table/data-table-column-header.tsx`.
  - Numeric cells `text-right tabular-nums`.
  - Column header tooltips (the distinction is the whole point of the table):
    - **Exclusive** — *"Blobs only this repository uses. Deleting the repository and running
      garbage collection frees this much."*
    - **Shared** — *"Blobs other repositories also use. Deleting this repository frees none of
      it."*
  - Pagination: `DataTablePagination` over a client-side slice (the agent returns all
    repositories in one response). Default 25.
  - Below `md`: hide `Layers` and `Manifests`. Below `sm`: hide `Shared` too, and put it under the
    repository name as `+ 240 MB shared` in `text-xs text-muted-foreground`.
- EMPTY (`repositories.length === 0`) → `EmptyState title="No repositories in storage"
  description="Nothing has been pushed to this registry yet."`

#### 6.3.6 Stale uploads

Source: `GET uploads?olderThanHours=N`, `POST uploads/purge`. Feature: `uploads`.

```
┌ Stale uploads ──────────────────────────────────────────────────────────────────┐
│ Layers left behind by pushes that were interrupted. They occupy disk but belong  │
│ to no image.                                                                     │
│                                                                                  │
│ Older than [ 24 ] hours                                        712 MB in 6 uploads│
│                                                                                  │
│ achasoft_dynevu_app     2 days ago      240 MB                                   │
│ achasoft_dynevu_worker  2 days ago      180 MB                                   │
│ … (+4 more)                                                                      │
│                                                  [ Purge 6 uploads ]             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- `olderThanHours`: `Input type="number" min={1}` defaulting to `24`, width `w-20`, with the
  refetch debounced 400 ms. `Label` is visible: *Older than … hours*.
- When the value is `< 6`, show below it, `text-xs text-[hsl(var(--severity-medium))]`:
  *"A large image can take hours to push. Uploads younger than the threshold are never touched,
  but a low threshold can catch a push that is still running."*
- List: first 5 rows then `+N more` (expand in place with a `Collapsible`, not pagination — this
  list is normally tiny). Each row: repository (mono, truncate) · `formatRelativeTime(startedAt)`
  with `title={formatDateTime(...)}` · `formatBytes(bytes)` right-aligned.
- Total on the right of the filter row: `formatBytes(totalBytes)` in `N uploads`.
- **Purge** — `Button variant="destructive" size="sm"`, label `Purge N uploads`, disabled when
  `uploads.length === 0`. Confirm dialog:

  > **Purge stale uploads?**
  > This deletes **6 partial uploads** (712 MB) older than **24 hours** from
  > **Achasoft Docker**. Anything younger is left alone. A push that is currently running and
  > older than the threshold would have to start over.
  > [Cancel] [Purge uploads]

- EMPTY → muted row: *No uploads older than 24 hours.* (no `EmptyState` — the card is small).
- Toast: `Purged 6 stale uploads — 712 MB freed` / `Nothing to purge — no uploads older than 24 hours`.

#### 6.3.7 Read-only mode

Source: `GET maintenance` / `PUT maintenance`. Feature: `maintenance`.

```
┌ Read-only mode ─────────────────────────────────────────────────────────────────┐
│ Rejects every push with 503 while you take a backup or migrate. Pulls keep       │
│ working. The setting survives a restart.                                         │
│                                                                                  │
│ Read-only                                                        [  ●───  ]      │
│                                                                                  │
│ Reason (shown to clients)                                                        │
│ [ nightly backup                                                     ]           │
│                                                                                  │
│ On since 2 hours ago · "nightly backup"                                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- `Switch` with `id="readOnly"` and a visible `Label`. Turning it **on** opens a confirm dialog
  (turning it off does not — restoring service should never need two clicks):

  > **Put this registry in read-only mode?**
  > Every push to **Achasoft Docker** will be rejected with `503` until you turn this off,
  > including pushes from CI. Pulls keep working.
  > **Reason** `[ nightly backup            ]`  *(Input inside the dialog, optional, max 200 chars)*
  > [Cancel] [Turn on read-only mode]

  The reason is collected in the dialog rather than the card so the state and its explanation are
  set in one `PUT`. The card's reason field is for editing it afterwards (`Input` + a **Save
  reason** button that appears only when the text changed, and only while `readOnly` is true).
- While `readOnly`, the card gets `border-[hsl(var(--severity-medium))]/40` so the page shows the
  abnormal state at a glance, and the `Notice` at the top of the page is the loud version.
- `since` line uses `formatRelativeTime` with a `formatDateTime` title.
- GC and repository removal use the same write gate but **do not** change this state
  (`agent/API.md:242`). Say so, muted, under the card: *"Garbage collection pauses pushes too, but
  it does not change this setting."*

#### 6.3.8 Logs

Source: `GET logs?source=&lines=`. Feature: `logs`.

```
┌ Logs ───────────────────────────────────────────────────────────────────────────┐
│ [ Registry | Agent | Registry Vault ]        [ 200 lines ▾ ] [Auto ●──] [⟳] [⧉]  │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ time="2026-09-28T18:40:01Z" level=info msg="response completed" …            │ │
│ │ …                                                                            │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│ The agent keeps the last 2,000 lines of each source in memory.                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Source**: `Tabs` (`TabsList`/`TabsTrigger`) — gives arrow-key navigation for free. The third
  tab is labelled with the extra process's product name, `Registry Vault`, and is rendered **only
  when `health.extra !== null`** (`agent/API.md:146`).
- **Lines**: `Select` with 100 / 200 / 500 / 1000 / 2000. Default 200. Label it with an
  `aria-label="Number of log lines"`.
- **Auto**: `Switch`, off by default, 5 s refetch when on. Keep it off by default — a log that
  jumps while you are reading it is worse than a refresh button.
- **Refresh**: `Button variant="outline" size="icon"` `aria-label="Refresh logs"`.
- **Copy**: `Button variant="ghost" size="icon"` `aria-label="Copy all log lines"`, copies
  `lines.join('\n')`, `Check` icon for 2 s (same interaction as `CopyCommand`).
- **Viewer**: `<pre>` inside
  `role="region" aria-label="Registry logs" tabIndex={0}` with
  `h-[320px] lg:h-[480px] overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre`
  — `tabIndex={0}` is required or keyboard users cannot scroll it. Auto-scroll to the bottom after
  a fetch **only when the user was already within 40 px of the bottom**.
- EMPTY → centred muted text inside the viewer: *No log lines yet.*
- LOADING → `Skeleton` filling the viewer box, not a spinner.

#### 6.3.9 Agent settings

Source: `GET settings` / `PUT settings`. Always available (Vault stores these, not the agent).

```
┌ Agent settings ─────────────────────────────────────────────────────────────────┐
│ Warn about low disk at  [ 85 ] %                                                 │
│ The dashboard and this registry show a warning at or above this usage.           │
│                                                                                  │
│ Scan new tags automatically                                        [  ●───  ]    │
│ Every newly pushed tag is scanned with Trivy. Scans run one at a time.           │
│                                                                                  │
│                                                            [ Save settings ]     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- `lowDiskWarningPercent`: `Input type="number" min={1} max={99}` `w-20`, suffix `%` as static
  text. Out of range → inline error *"Enter a number between 1 and 99."* and Save disabled.
- `autoScanOnPush`: `Switch`. When `scan` is not in `features`, the row is disabled with the
  NO-FEATURE reason under it.
- `gcSchedule` / `gcHour` / `gcAfterRetention` live in the GC card (§6.3.3), not here — same `PUT`,
  different place, because they read as part of garbage collection. Both blocks must send the full
  `IAgentSettings` object (it is a `PUT`), so read the current values from the shared query cache
  before sending. **This is the single easiest bug to introduce on this page** — a partial `PUT`
  from the settings card would silently reset the schedule.
- Save button disabled until something changed. Toast: `Agent settings saved`.

#### 6.3.10 Restart registry

```
┌ Restart registry ───────────────────────────────────────────────────────────────┐
│ Restarts the registry process. Pulls and pushes fail for a few seconds while it  │
│ comes back. The agent itself and this page keep running.                         │
│                                            [ Restart registry ]                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Card gets `border-destructive/30`; button `variant="destructive"`, `RotateCcw` icon.
- Disabled while `health.gc.state` is `queued`/`running`, with a `Tooltip`: *"Not while garbage
  collection is running."* (the agent answers `409` — `agent/API.md:150`).
- Confirm dialog:

  > **Restart the registry?**
  > Pulls and pushes to **Achasoft Docker** fail for a few seconds while the process restarts.
  > Anything mid-push has to start over.
  > [Cancel] [Restart registry]

- Flow after confirming, in §7.4.

---

### 6.4 Registry users

File: `apps/web/src/features/registry/pages/registry-users-page.tsx`
Source: `GET/POST users`, `PATCH/DELETE users/:username`. Feature: `users`.

The single most important job of this screen is not being mistaken for `/access/users`.

```
Breadcrumbs: ⌂ › Registries › Achasoft Docker › Registry users

[ Repositories ] [ Maintenance ] [ Registry users ]

Registry logins                                                  [ + Add login ]
Accounts that can `docker login` to this registry. These are not Registry Vault
users — they have no access to this web app.

[ docker login http://registry:5000                                          ⧉ ]

┌──────────────────────────────────────────────────────────────────────────────────┐
│ Username        Role      Created        Last used                               │
│ ⌨ ci            push      12 days ago    4 minutes ago      [ role ▾ ][ ↻ ][ 🗑 ] │
│ ⌨ deploy-bot    admin     3 months ago   Never              [ role ▾ ][ ↻ ][ 🗑 ] │
│ ⌨ readonly      pull      3 months ago   2 days ago         [ role ▾ ][ ↻ ][ 🗑 ] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

How it stays distinct from Vault's users page:

1. Different location and breadcrumb (`Registry users`), different title (**Registry logins**).
2. **No avatars.** `/access/users` leads with `Avatar` + display name; this page leads with a
   `Terminal` icon and a monospace username. Different silhouette at a glance.
3. Roles are lowercase **monospace** badges (`pull` / `push` / `admin`) because they are registry
   scopes; Vault roles are title-case (`Admin` / `Maintainer` / `Reader`).
4. The `docker login` command sits under the header — this page is about a CLI.
5. Recommended (one line, cheap): on `/access/users`, under the page description, add
   *"Looking for `docker login` accounts? Those live under each registry → Registry users."*

Details:

- `CopyCommand command={`docker login ${connection.url}`}` under the page header.
- Table columns and formatting:
  - **Username** — `font-mono text-sm`, `Terminal` icon `h-3.5 w-3.5 text-muted-foreground`.
  - **Role** — `Badge variant="outline" className="font-mono text-[11px]"`. `admin` additionally
    gets `border-[hsl(var(--severity-medium))]/40 text-[hsl(var(--severity-medium))]` — admin can
    delete tags and read the catalog (`agent/API.md:74`), which is worth seeing in a list.
  - **Created** — `formatRelativeTime(createdAt)`, `title={formatDateTime(createdAt)}`.
  - **Last used** — `lastUsedAt === null` → `Never` in `text-muted-foreground`; else relative +
    title. Never call `formatRelativeTime` on null (date-fns throws on `Invalid Date`) — use the
    new `formatRelativeTimeOr` helper (§9).
  - Below `md`: hide `Created`. Below `sm`: hide `Last used` and move both under the username as
    `created 12d ago · used 4m ago` in `text-xs text-muted-foreground`.
- **Role change** — inline `Select` in the row (`h-8 w-[92px] text-xs`), `aria-label={`Role for
  ${username}`}`. It applies immediately **except** when the new role is `admin` or the current
  role is `admin` — then a confirm dialog first:

  > **Give `deploy-bot` the admin role?**
  > Admin can delete tags and list the whole catalog, on top of pull and push.
  > [Cancel] [Change role]

  > **Remove admin from `deploy-bot`?**
  > It will no longer be able to delete tags or list the catalog. Anything automated that relies on
  > that will start failing.
  > [Cancel] [Change role]

  On cancel, reset the `Select` to the stored value.
- **Reset password** — `Button variant="ghost" size="icon"` `RotateCcw`,
  `aria-label={`Reset password for ${username}`}`. Confirm:

  > **Reset the password for `ci`?**
  > The current password stops working immediately. Anything using it — CI, a server, a local
  > `docker login` — fails until it is updated.
  > [Cancel] [Reset password]

  Then the one-time reveal (§7.3). Sends `PATCH { resetPassword: true }`.
- **Delete** — `Button variant="ghost" size="icon"` `Trash2 text-destructive`,
  `aria-label={`Delete ${username}`}`. Confirm:

  > **Delete `ci`?**
  > It can no longer pull from or push to **Achasoft Docker**. Images it pushed are not affected.
  > [Cancel] [Delete]

- **Add login** dialog:

```
Add registry login
Creates an account that can `docker login` to Achasoft Docker.

Username
[ ci                                     ]
Lowercase letters, numbers, dot, dash and underscore. 2–64 characters.

Role
[ push — pull and push images         ▾ ]

Generate a password for me                                        [  ●───  ]
The password is shown once after the account is created.

(when off:)
Password
[ ••••••••••••                           ]  At least 12 characters.

                                             [ Cancel ]  [ Create login ]
```

  - Username validation client-side against `^[a-z0-9][a-z0-9._-]{1,63}$` (`agent/API.md:254`),
    inline error *"Use lowercase letters, numbers, dot, dash or underscore, 2–64 characters,
    starting with a letter or number."* The reserved service name is rejected server-side — surface
    the API message verbatim under the field.
  - Role `Select` with descriptive options (the bare words are not self-explanatory):
    `pull — pull images only` / `push — pull and push images` /
    `admin — pull, push, delete tags and list the catalog`. Default `push`.
  - Generate `Switch` defaults **on**. Off → password `Input type="password"` with the 12-char
    minimum enforced client-side, and no reveal dialog afterwards (the API returns a password only
    when it generated one).
- LOADING → `TableSkeleton rows={4}` (existing component).
- EMPTY → `EmptyState icon={<Terminal/>} title="No registry logins yet"
  description="Create one so CI and developers can `docker login` to this registry."
  action={<Button>Add login</Button>}`.
- NO-FEATURE (`users` absent) → the tab is hidden; if reached by URL, the page body is the
  NO-FEATURE reason inside an `EmptyState` with title *Registry logins are not in use* and the
  `REGISTRY_AUTH=none` explanation.

---

### 6.5 Docker repository detail

File: `apps/web/src/features/docker/pages/docker-repository-detail-page.tsx`

```
← Back to Repositories
achasoft_dynevu_manage                                     [Private] [🗑 Delete repository]

┌ Tags 16 ┐ ┌ Total Pulls 4.2K ┐ ┌ Total Size 399.7 MB ┐ ┌ Last Updated 12 days ago ┐

┌ Pull activity ──────────────────────────────────────────────────────────────────┐
│ Last pulled 4 minutes ago                          [ 7 days | 30 days | 90 days ]│
│  ▁▂▅█▆▃▁▂▄▇█▅▃▂▁▃▅▆█▇▄▂▁▂▃▅▇█▆                                                  │
│ 4,218 pulls in the last 30 days                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘

🛡 Tags 16                                              [ Cleanup ] [ Select ]
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 🏷 latest  ⊕linux/arm64                          ⇣ 1.2K  25 MB                   │
│    sha256:254e15e48856…  [3 Critical][8 High]    4m ago  12 days ago       [🛡] ›│
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### 6.5.1 Pull activity card

New component `features/docker/components/pull-activity-card.tsx`.
Source: `GET /api/docker/repositories/:repoId/pulls?days=` → `IDockerPullStats`.
Feature: `events`.

- **Range**: `Tabs` with `7 days` / `30 days` / `90 days`; default 30. State is local; the query
  key includes `days`.
- **Chart**: `ChartContainer` + `AreaChart`, built exactly like
  `features/dashboard/components/pull-push-chart.tsx` (same `defs` gradient, same axes config), but
  a single series:
  ```ts
  const chartConfig = { pulls: { label: 'Pulls', color: 'hsl(var(--docker))' } };
  ```
  Using the product token here rather than a new chart colour keeps the Docker pages one colour
  family. `aspect-[3/1] w-full` (flatter than the dashboard's `2/1`; it is a supporting card).
  X-axis label `format(parseISO(date),'MMM d')`, `interval="preserveStartEnd"`. Tooltip label
  `format(parseISO(date),'EEEE, MMM d')`, matching the dashboard.
- **Header right**: `Last pulled <relative>` or `Never pulled` (muted).
- **Footer**: `{formatNumber(totalPulls)} pulls in the last {days} days`, `text-sm`.
- **`incomplete === true`** → `Notice tone="info"` inside the card, above the chart:
  > **Some history is missing**
  > The agent prunes its event log (30 days by default), so days before that show fewer pulls than
  > actually happened.
- **EMPTY** (`totalPulls === 0`) → keep the chart (a flat zero line is information) and add a
  muted line: *No pulls recorded in this period.*
- **NO-AGENT** → the whole card is replaced by the one-sentence NO-AGENT variant (§4.2).
- **NO-FEATURE** (`events`) → the NO-FEATURE row.
- **LOADING** → `Skeleton className="aspect-[3/1] w-full"` inside the real card.

Note: the `Total Pulls` StatCard now shows `repo.totalPulls`, which is only meaningful with an
agent. Without one it reads `0` and looks like a bug. Without an agent, give that card a
`Tooltip`: *"Pull counts need a registry agent."* Do **not** add a fifth stat card for "last
pulled" — it breaks the `lg:grid-cols-4` rhythm; it lives in the Pull activity header.

#### 6.5.2 Tag rows

`TagRow` (line 55) changes:

- **Right metric cluster** (`hidden sm:flex`, line 96) gains a pulls column before size:
  ```
  ⇣ 1.2K            25 MB
  4m ago            12 days ago
  ```
  Pulls: `Download` icon + `formatNumber(tag.pullCount)`, `title={tag.pullCount.toLocaleString()}`.
  Second line: `formatRelativeTimeOr(tag.lastPulledAt, 'Never')`. Whole cluster hidden below `sm`
  exactly as today. When there is no agent, omit the pulls column entirely rather than printing
  `0` — `pullCount` is documented as `0` without an agent, and a zero that means "unknown" is a
  lie.
- **Vulnerability badges** (`VulnBadges`, line 32) are replaced by a `TagScanStatus` component:

  | Condition | Renders |
  |---|---|
  | `scanState === 'queued'` | `Badge variant="outline"` `Scan queued` (muted) |
  | `scanState === 'running'` | `Badge variant="outline"` with `Loader2 animate-spin h-3 w-3` + `Scanning…` |
  | `scanState === 'failed'` | `Badge variant="outline"` destructive-toned `Scan failed`, `Tooltip` with the error |
  | counts > 0 | `<SeverityBadge>` per non-zero severity, in `SEVERITY_ORDER`, including `unknown` |
  | all counts 0 **and** `lastScannedAt` set | `<SeverityBadge severity="none" />` → `Clean` |
  | all counts 0 **and** no `lastScannedAt` | `Badge variant="outline"` muted `Not scanned` |

  That last row fixes a real bug: today every unscanned tag renders **Clean**
  (`docker-repository-detail-page.tsx:41-43`), which is visible in `screenshots/docker-3.png` — a
  registry with no scanner at all is reporting every image as clean.

- **Scan action**: a `Button variant="ghost" size="icon"` **as a sibling of the row button**, not
  inside it. The row is a `<button>` (line 79); nesting another button inside is invalid HTML and
  breaks keyboard navigation. Structure:

  ```tsx
  <div className="flex items-center gap-2">
    {selectionMode && <Checkbox … />}
    <button className="w-full flex … ">…</button>
    {canScan && (
      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
        aria-label={`Scan ${tag.name} for vulnerabilities`}
        title="Scan for vulnerabilities"
        disabled={!isAdmin || scanState === 'queued' || scanState === 'running'}
        onClick={() => scan.mutate({ repositoryId, tag: tag.name })}>
        <ShieldCheck className="h-4 w-4" />
      </Button>
    )}
  </div>
  ```

  `canScan` = the connection has an agent with `scan` in `features`. Hidden entirely otherwise
  (a per-row disabled button on 100 rows is noise; the capability is explained once on the tag
  detail page).
- The row `<button>` has no visible focus ring today. Add
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
  — it is a keyboard target on every Docker page.

#### 6.5.3 Delete repository

New `Button variant="outline"` with `Trash2 text-destructive` in the `PageHeader` children, next
to the Public/Private badge. Admin-only. Confirm dialog:

> **Delete `achasoft_dynevu_manage`?**
> Its 16 tags and its directory are removed from the registry's storage, and it disappears from
> Registry Vault. **Disk space comes back the next time garbage collection runs** — until then the
> blobs are still on disk.
> *(when the agent reports `exclusiveBytes` for it)* About **1.2 GB** will be freed; 240 MB of its
> layers are shared with other repositories and stay.
> *(when there is no agent)* Without a registry agent the directory cannot be removed — the
> repository stops listing tags but its folder stays on disk.
> [Cancel] [Delete repository]

- Confirm button `variant="destructive"`, label `Delete repository`. Cancel `autoFocus`.
- The repository still has tags, so the API call must carry `force: true`
  (`IRemoveRepositoryRequest`). Say so in the dialog implicitly — the first line already names the
  16 tags.
- Toast on success: `Deleted achasoft_dynevu_manage — space returns after the next garbage
  collection`, with a sonner `action: { label: 'Run GC', onClick: … }` linking to the maintenance
  page. Then `navigate` back to the repositories list.
- RUNNING (GC) → the button is disabled with a `Tooltip`: *"Not while garbage collection is
  running."* (the agent's write gate would reject it).

#### 6.5.4 Cleanup dialog

Add a third criterion, between the existing two:

```
Delete tags not pulled for N days
[ 90                                          ]
Only tags nobody has pulled for this long are removed. Needs a registry agent.
```

- `Input type="number" min={1}`, maps to `ICleanupVersionsRequest.notPulledForDays`.
- **No agent, or `events` missing** → `disabled`, and the helper line is replaced by
  *"Needs a registry agent on this connection — it is what counts pulls."* plus a text-button
  **Set up an agent**. Disabled rather than hidden so the capability is discoverable (D6).
- The dialog's existing description says "Criteria are applied together" — keep it; with three
  criteria that sentence is doing more work, so make it explicit:
  *"A tag is deleted only if it matches every criterion you fill in. Leave a field empty to skip
  it."*
- Enable the submit when **any** criterion is set (extend the existing
  `(!keepCount && !olderThanDays)` guard to include `notPulledForDays`).

---

### 6.6 Docker tag detail

File: `apps/web/src/features/docker/pages/docker-tag-detail-page.tsx`

The existing Vulnerabilities card (a bar chart of counts) becomes the **summary**; a findings
table is added below it, full width.

```
┌ Vulnerabilities ────────────────────────────────────────────────────────────────┐
│ Critical  3  ████░░░░░░                          Scanned 4 minutes ago            │
│ High      8  ██████░░░░                          linux/amd64 · Trivy              │
│ Medium   12  ████████░░                                        [ ⟳ Rescan ]       │
│ Low      31  ██████████                                                           │
│ Unknown   2  █░░░░░░░░░                                                           │
└──────────────────────────────────────────────────────────────────────────────────┘

┌ Findings 56 ────────────────────────────────────────────────────────────────────┐
│ [Critical 3] [High 8] [Medium 12] [Low 31] [Unknown 2]   [ 🔍 package or CVE   ] │
│                                                                                  │
│ Severity   CVE               Package     Installed → Fixed                       │
│ CRITICAL   CVE-2024-0001 ⧉   openssl     3.0.1 → 3.0.2                           │
│ HIGH       CVE-2024-0117 ⧉   zlib        1.2.11 → no fix                         │
│ …                                                       [ 25 / 50 / 100 ]        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### Summary card changes

- Add an `Unknown` row (the summary now carries `unknown`), using `--severity-unknown`.
- Bars use the severity tokens (§3.1). Keep the existing `Math.min(val*5,100)` width heuristic —
  it is a sparkline, not a measurement; add `aria-hidden="true"` to the bars and put the number in
  the text, which is already there.
- Right column: `Scanned <relative>` (`lastScannedAt`, title = exact), then
  `{scan.platform} · Trivy` in `text-xs text-muted-foreground`, then the **Rescan** button
  (`variant="outline" size="sm"`, `RefreshCw`, admin-only).
- States: `scanState === 'queued' | 'running'` → replace the right column with
  `⟳ Scanning…` + *"Scans run one at a time; this can take a few minutes."*, Rescan disabled.

#### Findings table

New component `features/docker/components/scan-findings-table.tsx`.
Source: `GET /api/docker/repositories/:repoId/tags/:tag/scan` → `IScanResult | null`.

- Built from the raw `components/ui/table` primitives plus `DataTablePagination` — **not**
  `DataTable`, which has no pagination and a findings list runs to hundreds of rows. Sorting is
  local: severity (`SEVERITY_ORDER`) then `pkgName`, then `id`.
- Columns:

  | Column | Content | Responsive |
  |---|---|---|
  | Severity | `<SeverityBadge severity={…} />` (no count) | always |
  | CVE | `id` in `font-mono text-xs`; when `primaryUrl`, an `<a target="_blank" rel="noopener noreferrer">` with an `ExternalLink h-3 w-3` and `aria-label={`${id} (opens in a new tab)`}` | always |
  | Package | `pkgName` mono | always |
  | Installed → Fixed | `3.0.1 → 3.0.2`; no `fixedVersion` → `3.0.1 →` + `Badge variant="outline"` muted `no fix` | hidden below `sm`, shown as a second line under the CVE |
  | Title | `title`, truncated, full text in a `Tooltip` | `hidden lg:table-cell` |

  `<caption className="sr-only">Vulnerabilities found in achasoft_dynevu_manage:latest</caption>`.
- **Severity filter chips**: one `Button` per severity,
  `variant={active ? 'secondary' : 'outline'} size="sm"`, `aria-pressed={active}`, label
  `Critical 3`. Multi-select; none selected = all shown. A severity with zero findings renders
  disabled.
- **Text filter**: `Input` with a `Search` icon, placeholder `package or CVE`, filters `pkgName`
  and `id`, case-insensitive, debounced 200 ms. Resets the page to 1.
- Filtered-to-empty → a table row: *No findings match these filters.* + a text-button **Clear
  filters**.

#### States

| State | Render |
|---|---|
| **Never scanned** (`GET scan` → `null`) | `EmptyState icon={<ShieldQuestion/>} title="This tag has not been scanned" description="Trivy checks the image's packages against known vulnerabilities. A scan takes a few minutes and runs on the agent host." action={<Button>Scan now</Button>}` |
| **Queued** | `EmptyState icon={<Clock/>} title="Scan queued" description="Scans run one at a time. This one starts when the current scan finishes."` |
| **Running** | `EmptyState icon={<Loader2 className="animate-spin"/>} title="Scanning…" description="Started 40 seconds ago."` |
| **Succeeded, 0 findings** | `EmptyState icon={<ShieldCheck className="text-[hsl(var(--severity-none))]"/>} title="No known vulnerabilities" description="Scanned <relative> against Trivy's database for linux/amd64."` |
| **Failed** | `Notice tone="danger"` title `Scan failed`, body `scan.error` in mono `text-xs`, action **Try again**. Plus a muted line: *"If this was the first scan on this agent: Trivy downloads its vulnerability database on first use, which needs internet access from the agent host."* |
| **NO-FEATURE (`scan`)** | the NO-FEATURE row, with the Trivy reason |
| **NO-AGENT** | the one-sentence NO-AGENT variant: *"Vulnerability scanning needs a registry agent on this connection."* |
| **LOADING** | `TableSkeleton rows={6}` |

Multi-arch note: `IScanRequest.platform` is optional and defaults to `linux/amd64`
(`agent/API.md:301`). When the tag has more than one runnable platform (`runnablePlatforms()`
already exists in `features/docker/components/platform-badges.tsx`), the **Rescan** button becomes
a `DropdownMenu` listing each platform plus `linux/amd64 (default)`, and the summary card states
which platform the shown result is for. Without that, a user scans an arm64 image and silently
gets amd64 results.

---

### 6.7 Retention policies

File: `apps/web/src/features/settings/components/retention-policies.tsx`

Two new fields in the create/edit dialog, in a Docker-only block after the exclude pattern:

```
────────────────────────────────────────────────
DOCKER ONLY

Delete tags not pulled for (days)
[ 90                                          ]
Needs a registry agent — it is what counts pulls.
Applies to: Achasoft Docker.  Not available on: Legacy Registry.

▢ Run garbage collection afterwards
Retention deletes tags; garbage collection is what frees the disk.
────────────────────────────────────────────────
```

- The block renders only when `formType === RegistryType.Docker`.
- A retention policy targets a registry **type**, not a connection (`IRetentionPolicy` has
  `registryType` and no connection id). So gating is: **enabled when at least one Docker connection
  has an agent**, and the helper line names which connections it will and will not apply to —
  otherwise the operator sets a rule that silently does nothing on half their registries.
  - `connections.filter(c => c.registryType === Docker && c.agent)` → *Applies to: …*
  - the complement → *Not available on: …* (muted; omit the sentence when the list is empty)
  - no Docker connection has an agent → both inputs `disabled`, helper replaced by
    *"No Docker registry has an agent yet. Set one up to delete tags by pull activity."* +
    **Set up an agent** link.
- `runGcAfter`: `Switch` + `Label`, same disabled rule.
- **Policy summary chips** in the list row (`retention-policies.tsx:186-208`) gain two entries,
  matching the existing `icon + text` idiom:
  - `<Download className="h-3 w-3" /> Not pulled for {notPulledForDays} days`
  - `<Trash2 className="h-3 w-3" /> Runs GC afterwards`
  - The `No criteria set` fallback condition must include the new field, or a pull-only policy
    renders as having no criteria.
- Submit guard: enable Save when any of `keepLastN`, `olderThanDays`, `notPulledForDays` is set.

---

### 6.8 Dashboard

File: `apps/web/src/features/dashboard/pages/dashboard-page.tsx`
New component: `features/dashboard/components/registry-agents-card.tsx`
Source: `GET /api/registries/agents/overview` → `IAgentOverviewItem[]`. Poll 60 s.

#### Low-disk banner

At the very top of the page, above `PageHeader`. One `Notice tone="warning"` per affected
connection, or a single combined one when more than two:

> **Achasoft Docker is running low on disk**
> 92% of the disk holding the registry's storage is used — 16 GB free of 200 GB. Garbage collection
> may free space that deleted tags still occupy.
> **action** `<Button variant="outline" size="sm">` Open maintenance

Combined form (3+): title *3 registries are running low on disk*, body listing
`name — 92% used` per line, action **Open the first one**… no: action is omitted; the agents card
directly below carries the per-row links. Keep the banner as the alarm and the card as the detail.

The banner does **not** go in `AppLayout`. That slot holds the global `maintenanceMode` banner; a
per-connection disk warning on every page of the app (including pages about other registries) is
noise the operator will learn to ignore.

#### Registry agents card

Row placement: the existing `lg:grid-cols-2` row becomes **[Registry Health] [Registry Agents]**,
and **Recent Activity moves to its own full-width row below**. Activity is a scrolling feed and
reads better wide; the two health-ish cards belong side by side.

```
┌ Registry agents ────────────────────────────────────────────────────────────────┐
│ Achasoft Docker          ● Online                                              › │
│ [███████████░░░] 78% used · 44.1 GB free            [Read-only] [GC running]     │
│                                                                                  │
│ Legacy Registry          ● Offline                                             › │
│ Last reached 3 hours ago                                                         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- `CardTitle`: **Registry agents**, `CardDescription`: *Disk and maintenance state of every
  registry running an agent.*
- Each row is a `<Link to={`/registry/${connectionId}/maintenance`}>` styled like the existing
  bordered rows (`rounded-lg border p-3 hover:bg-accent/50`), with a `ChevronRight` and a visible
  focus ring.
- Line 1: connection name + `<AgentStatusBadge>`.
- Line 2:
  - `status === 'online'` → `<DiskUsageBar>` + `78% used · 44.1 GB free`, plus chips:
    `maintenance.readOnly` → `Badge` `Read-only` (`--severity-medium`);
    `gc.state` in `queued|running` → `Badge` `GC running` (`--severity-medium`) with a spinner.
  - `offline` → `Last reached <relative>` (muted) — from `connection.agent.lastSeenAt`, since the
    overview item has no timestamp. **(unverified: `IAgentOverviewItem` carries no `lastSeenAt`;
    join on the connections query, or add it to the endpoint — Q5.)**
  - `unauthorized` → *The stored API key was rejected.* with an **Edit connection** text-button.
  - `disk` undefined → omit the bar (it is optional on the type).
- `lowDisk` rows get `border-[hsl(var(--severity-high))]/40`.
- **EMPTY** (no connection has an agent) → inside the card, an `EmptyState className="py-8"`:
  > **No registry agents yet**
  > An agent runs next to a Docker registry and lets Registry Vault reclaim disk space, count
  > pulls, manage `docker login` accounts and scan images — none of which the registry API can do
  > on its own.
  > **action** Set up an agent → `/settings/registries`

  Render the card even when empty: this is how the feature is discovered. **(Alternative
  considered: hide the card entirely when no agent exists. Rejected — nothing else in the app
  mentions the agent, so the feature would be invisible to anyone who has not read the release
  notes.)**
- **LOADING** → three `Skeleton className="h-16"` rows.
- **ERROR** → `Notice tone="danger"` inside the card with **Retry**.

---

## 7. Interaction flows

### 7.1 Query layer

New file `apps/web/src/services/queries/agent.queries.ts`, following the existing conventions
(`useQuery` + `select: r => r.data`, mutations with sonner toasts, `queryKeys`).

Add to `services/queries/query-keys.ts`:

```ts
agent: {
  health:   (id: string) => ['agent', id, 'health'] as const,
  storage:  (id: string, refresh: boolean) => ['agent', id, 'storage', refresh] as const,
  gc:       (id: string) => ['agent', id, 'gc'] as const,
  gcHistory:(id: string) => ['agent', id, 'gc', 'history'] as const,
  uploads:  (id: string, hours: number) => ['agent', id, 'uploads', hours] as const,
  maintenance: (id: string) => ['agent', id, 'maintenance'] as const,
  logs:     (id: string, source: AgentLogSource, lines: number) => ['agent', id, 'logs', source, lines] as const,
  users:    (id: string) => ['agent', id, 'users'] as const,
  settings: (id: string) => ['agent', id, 'settings'] as const,
  overview: ['agent', 'overview'] as const,
},
docker: {
  pulls: (repoId: string, days: number) => ['docker', 'pulls', repoId, days] as const,
  scan:  (repoId: string, tag: string) => ['docker', 'scan', repoId, tag] as const,
},
```

Polling cadences. All of them rely on react-query's `refetchIntervalInBackground` defaulting to
`false`: the interval timer keeps ticking, but the fetch is skipped unless the window is focused
(verified in the installed `@tanstack/query-core@5.90.20`, `queryObserver.js:215` —
`if (this.options.refetchIntervalInBackground || focusManager.isFocused())`). So a maintenance tab
left open in the background costs nothing, and **no manual visibility handling is needed**. Do not
pass `refetchIntervalInBackground: true` anywhere in this feature.

| Query | Interval | Notes |
|---|---|---|
| `health` | 15 s; **5 s** while `gc.state` is `queued`/`running` | shared cache: the registry page, repository detail pages and the maintenance page all mount it, one request per interval |
| `gc` (current job) | **2 s** while `queued`/`running`, else `false` | `refetchInterval: q => ['queued','running'].includes(q.state.data?.state) ? 2000 : false` |
| `agents/overview` | 60 s | dashboard only |
| `storage` | none | manual **Recompute**, `staleTime: 5 * 60_000` |
| `uploads` | none | refetch when `olderThanHours` changes (400 ms debounce) |
| `logs` | none; **5 s** when Auto is on | |
| `scan` (tag detail) | **3 s** while `queued`/`running`, else `false` | |
| docker `tags` list | existing 5 min; **10 s** while any tag has `scanState` `queued`/`running` | |
| `users`, `settings`, `maintenance` | none | invalidate after their own mutations |

### 7.2 Garbage collection

```
[Run garbage collection] → confirm dialog → POST gc { dryRun:false }
   ├─ 409 → toast.error "Another garbage collection is already running."  → refetch gc
   ├─ 409 (registry < 3) → toast.error with the agent's message → show GC-UNSUPPORTED
   └─ 202 → seed the gc cache with the returned job
            toast.info "Garbage collection started — pushes are paused until it finishes."
            poll GET gc every 2 s
              · card shows RUNNING, both buttons disabled, elapsed timer, output tail
              · the RUNNING notice appears on the registry page and this connection's
                repository detail pages (they share the health query, which now polls 5 s)
              · a 1 s local interval ticks the elapsed clock — do not poll for it
            on state 'succeeded' → stop polling
                 toast.success "Garbage collection freed 1.2 GB"
                          (freedBytes === 0 → "Garbage collection finished — nothing to free")
                 invalidate: agent.storage, agent.health, ['docker']
            on state 'failed' → stop polling
                 toast.error "Garbage collection failed — <error>"
            after 30 minutes of polling → stop, show
                 Notice tone="warning" "Still running — this is taking longer than expected."
                 with a [Check again] button that resumes polling
```

The 30-minute cap exists so a tab left open overnight does not hammer the API forever. State it as
a constant `GC_POLL_TIMEOUT_MS`, not a magic number.

Dry run is the same flow with `dryRun: true`, minus the confirm dialog, minus the RUNNING notices
elsewhere (the write gate stays open — `agent/API.md:208`), and with the result worded as *would
delete*.

### 7.3 One-time password reveal

Used after **Add login** (generate on) and after **Reset password**.

```
POST users / PATCH users/:u  → 201/200 { user, password? }
   password absent (the caller supplied one) → close the dialog, toast.success, done
   password present →
     the dialog's content is REPLACED (same Dialog instance, no flash of the list):

     ┌──────────────────────────────────────────────────────────────┐
     │ Save this password now                                        │
     │ It is shown once. Registry Vault does not store it and cannot │
     │ show it again — if you lose it, reset the password.           │
     │                                                               │
     │ Username  [ ci                                    ] ⧉         │
     │ Password  [ x8Q2-vR7m-… (readOnly, text, mono)    ] ⧉         │
     │                                                               │
     │ docker login http://registry:5000 -u ci                    ⧉  │
     │                                                               │
     │                                    [ I have saved it ]        │
     └──────────────────────────────────────────────────────────────┘
```

- The password field is a real `<input readOnly type="text" className="font-mono">` with a visible
  `<Label>`, not a `<code>` block: it is selectable, focusable and announced by a screen reader,
  and `type="text"` is correct because the whole point of the screen is to read it.
- Copy buttons reuse the `CopyCommand` interaction (`Check` for 2 s). `aria-label="Copy password"`;
  on copy, set a `role="status"` node to `Password copied` so it is announced.
- `docker login …` line is a `CopyCommand` with the connection URL and `-u <username>`.
- **Dismissal**: Esc and the backdrop stay enabled — a dialog that traps you is an accessibility
  failure, and a modal you cannot leave is worse than a lost password. Instead, on any dismissal
  that is not the explicit button, fire `toast.warning('Password dismissed — reset it if you did
  not copy it.')`. The explicit button fires no extra toast.
- The Dialog's default close **X** is hidden here (`[&>button]:hidden` on `DialogContent`) so the
  deliberate button is the obvious exit.
- Non-admins never reach this flow (they cannot create or reset).

### 7.4 Restart registry

```
[Restart registry] → confirm → POST registry/restart
   ├─ 409 → toast.error "Cannot restart while garbage collection is running."
   └─ 202 → toast.info "Restarting the registry…"
            capture health.registry.startedAt as `before`
            poll health every 2 s (override the 15 s interval for up to 60 s)
            when registry.running && startedAt !== before →
                 toast.success "The registry is back up."
                 restore the 15 s interval
            after 60 s without that →
                 Notice tone="danger" on the Overview card:
                 "The registry has not come back. Check the logs."  [View logs] → the Logs card
```

### 7.5 Scan

```
[🛡 on a tag row] or [Scan now] / [Rescan] → POST …/tags/:tag/scan { platform? }
   ├─ 409 (queue full) → toast.error "The scan queue is full (50). Try again in a few minutes."
   └─ 202 → toast.info "Scan queued for achasoft_dynevu_manage:latest"
            the row badge becomes "Scan queued"
            tag detail open  → poll GET …/scan every 3 s
            list page open   → poll the tags list every 10 s while any tag is queued/running
            on 'succeeded' → stop
                 toast.success "Scan finished — 3 critical, 8 high"
                              (0 findings → "Scan finished — no known vulnerabilities")
                 invalidate the tags list and the scan query
            on 'failed'   → stop; toast.error "Scan failed — <error>"
            after 10 minutes → stop polling, leave the badge as-is,
                 muted line "Still scanning — reload to check."
```

Scans are serialised on the agent (`agent/API.md:302`), so a queued scan can sit for minutes.
Never show a determinate progress bar for it.

---

## 8. Toast catalogue

All via `sonner` (`toast` from `'sonner'`), matching the existing style in
`services/queries/*.queries.ts`: sentence case, no trailing period on short confirmations, the
server's message appended after an em dash on failures.

| Event | Call |
|---|---|
| Test agent ok | `toast.success('Agent reachable — v1.0.0, registry 3.0.0')` |
| Test agent unreachable | `toast.error('Could not reach the agent — ' + message)` |
| Test agent unauthorized | `toast.error('The agent rejected this API key')` |
| GC started | `toast.info('Garbage collection started — pushes are paused until it finishes')` |
| GC freed space | `toast.success('Garbage collection freed 1.2 GB')` |
| GC freed nothing | `toast.success('Garbage collection finished — nothing to free')` |
| GC failed | `toast.error('Garbage collection failed — ' + error)` |
| GC already running | `toast.error('Another garbage collection is already running')` |
| Dry run done | `toast.success('Dry run finished — 1.2 GB can be freed')` / `'…— nothing to free'` |
| GC schedule saved | `toast.success('Garbage collection schedule saved')` |
| Uploads purged | `toast.success('Purged 6 stale uploads — 712 MB freed')` |
| Nothing to purge | `toast.info('Nothing to purge — no uploads older than 24 hours')` |
| Read-only on | `toast.success('Read-only mode on — pushes are rejected')` |
| Read-only off | `toast.success('Read-only mode off — pushes are accepted again')` |
| Restart requested | `toast.info('Restarting the registry…')` |
| Restart done | `toast.success('The registry is back up')` |
| Restart blocked | `toast.error('Cannot restart while garbage collection is running')` |
| Agent settings saved | `toast.success('Agent settings saved')` |
| Login created | `toast.success('Created ci')` |
| Role changed | `toast.success('ci is now push')` |
| Password reset | `toast.success('New password generated for ci')` |
| Login deleted | `toast.success('Deleted ci')` |
| Password dismissed | `toast.warning('Password dismissed — reset it if you did not copy it')` |
| Scan queued | `toast.info('Scan queued for achasoft_dynevu_manage:latest')` |
| Scan finished | `toast.success('Scan finished — 3 critical, 8 high')` |
| Scan clean | `toast.success('Scan finished — no known vulnerabilities')` |
| Scan failed | `toast.error('Scan failed — ' + error)` |
| Scan queue full | `toast.error('The scan queue is full (50). Try again in a few minutes')` |
| Repository removed | `toast.success('Removed achasoft_dynevu_manage', { description: 'Disk space returns after the next garbage collection.' })` |

---

## 9. Formatting rules

| Value | Rule | Helper |
|---|---|---|
| Any byte count | 1024-based, 1 decimal, `B/KB/MB/GB/TB` | `formatBytes` (`lib/formatters.ts`) — use it for `freedBytes`, `exclusiveBytes`, `totalBytes`, disk figures |
| Zero bytes | `formatBytes(0)` → `0 B`; in GC results say *nothing to free* instead | — |
| Pull counts, blob/manifest counts | `formatNumber` (K/M above 1000), exact value in `title` | `formatNumber` |
| Disk percentage | `${Math.round(disk.usedPercent)}%` — the agent already computes the percentage | **Do not** use `formatPercentage(value,total)`; it takes two arguments and computing it again from `usedBytes/totalBytes` drifts from the agent's own statfs figure |
| "when" in a list or tile | `formatRelativeTime`, with `title={formatDateTime(x)}` | existing helpers |
| A nullable "when" | `Never` in `text-muted-foreground` | **new** `formatRelativeTimeOr(x?: string \| null, fallback = 'Never')` in `lib/formatters.ts` — see the warning below |
| Durations (GC runtime, uptime) | `3m 41s`, `6d` | **new** `formatDuration(ms)` in `lib/formatters.ts`, or `formatDistanceToNowStrict` from date-fns for uptime |
| Chart day labels | `format(parseISO(date), 'MMM d')`; tooltip `'EEEE, MMM d'` | mirrors `pull-push-chart.tsx` |
| Digests, usernames, repository names, log lines, CVE ids, versions, roles | `font-mono` | — |
| Numbers in table cells | `text-right tabular-nums` | — |
| Hours (GC schedule) | `00:00`–`23:00`, server local time, stated in the helper text | — |

### Why `formatRelativeTimeOr` is not optional

Verified against the installed `date-fns@4.1.0`:

```
formatRelativeTime(undefined)  →  throws RangeError: Invalid time value   (crashes the component)
formatRelativeTime(null)       →  "over 56 years ago"                     (silently wrong: new Date(null) is the epoch)
formatRelativeTime('')         →  throws RangeError: Invalid time value
```

The `null` case is the dangerous one, and it is not hypothetical: `IRegistryUser.lastUsedAt` is
typed `string | null`, so a login that has never been used renders **"over 56 years ago"** —
plausible-looking, wrong, and it will not be caught by types or by a crash. The same shape applies
to `IAgentMaintenance.since`, `IAgentProcess.lastExit` and `IAgentGcJob.startedAt`.

Every existing call site in the app happens to be guarded by a truthiness check
(`credentials-management.tsx:63`, `docker-tag-detail-page.tsx:99-100`), so this is a latent trap
rather than a live bug — but this feature adds roughly a dozen new nullable timestamps. Add the
helper once and use it everywhere:

```ts
export function formatRelativeTimeOr(value?: string | null, fallback = 'Never'): string {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : formatDistanceToNow(d, { addSuffix: true });
}
```

---

## 10. Responsive behaviour

The app's breakpoints are Tailwind defaults; the existing idiom is `hidden sm:flex` for secondary
metric clusters and `grid gap-4 lg:grid-cols-2` for card rows. Follow it.

At **375 px**:

- **Tab strip**: `-mx-4 px-4 overflow-x-auto` with `whitespace-nowrap` so three tabs scroll instead
  of wrapping or clipping. (The Settings tab strip has the same problem with five tabs today —
  worth the same one-line fix while you are in there.)
- **Every card row** (`lg:grid-cols-2`) stacks to one column below `lg`. Page padding stays the
  layout's `p-4`.
- **Overview tiles**: `grid-cols-2` below `lg` — two tiles per row, never one (they are short).
- **Tables**: the rule is *hide low-priority columns, never rely on horizontal scroll*.
  - Storage: `md` hides Layers + Manifests; `sm` hides Shared and folds it under the name.
  - Registry users: `md` hides Created; `sm` hides Last used and folds both under the username.
  - Findings: `lg` hides Title; `sm` hides Installed → Fixed and folds it under the CVE.
  - Row action buttons grow from `h-8 w-8` to `h-9 w-9` below `sm` (36 px; still short of the 44 px
    ideal, but consistent with the app and reachable).
- **GC card**: the two buttons go `w-full` and stack below `sm`; the header's button row becomes
  `flex-col gap-2 sm:flex-row`.
- **Log viewer**: `h-[320px]` below `lg`, `text-[11px]`, horizontal scroll is correct here (log
  lines are long and must not wrap).
- **Charts**: `ChartContainer` is already fluid; the pull-activity aspect goes `aspect-[3/2]` below
  `sm` so the line is not a sliver.
- **Dialogs**: `sm:max-w-lg max-h-[85vh] overflow-y-auto` on the connection dialog and the add-login
  dialog; on phone shadcn's dialog is already full-width with margins.
- **Notices**: `flex-col` — the action button drops below the text and goes `w-full sm:w-auto`.
- **Dashboard agents card**: the disk bar and the chips stack; the chevron stays right-aligned on
  the first line.

---

## 11. Accessibility

Requirements, not polish. Each is a thing to check in review.

1. **Never colour alone.** Every status dot, severity badge and disk bar carries a text label.
   `AgentStatusBadge` says "Agent offline", not a red dot. The sidebar dot is `aria-hidden` and the
   meaning lives in the link's `aria-label`.
2. **Contrast.** Severity tokens are specified at ≥ 4.5:1 in their **worst** case — the token as
   text on a 10% tint of itself, which is what a `SeverityBadge` is — not merely against
   `--background` (§3.1 has the measured table). A `/10` tint *reduces* contrast; if you deepen a
   badge fill to `/15` or `/20`, recompute. Muted helper text stays `--muted-foreground`, which the
   app already ships.
3. **Focus visibility.** shadcn primitives carry `focus-visible:ring-2 ring-ring`. The hand-rolled
   `<button>` list rows (tag rows, agent rows, repository rows) do **not** — add
   `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
   to every one this spec touches.
4. **No nested interactives.** The tag row's Scan button is a *sibling* of the row button
   (§6.5.2). Same rule for the dashboard agent rows: the row is the link; no button inside it.
5. **Accessible names on icon-only buttons.** `aria-label` **and** `title` (the app currently uses
   `title` alone in `registry-connections.tsx` — `title` is not a reliable accessible name).
6. **Live regions.** The GC status line, the restart status line and the scan status line get
   `aria-live="polite"`. `Notice tone="danger"` gets `role="alert"`. Sonner already announces
   toasts; do not double-announce the same fact in both a toast and a live region for the same
   event — pick the live region for in-page state, the toast for the transition.
7. **Progress semantics.** Disk bars carry `role="progressbar"` with `aria-valuenow/min/max` and an
   `aria-valuetext` that spells out the bytes (§3.3) — "78%" alone does not say whether that is
   40 GB or 400 MB of headroom. The severity sparkline bars on the tag page are decoration:
   `aria-hidden="true"`, with the number in text beside them.
8. **Scrollable regions are focusable.** The log `<pre>` gets `tabIndex={0}` + `role="region"` +
   `aria-label`, or keyboard users cannot scroll it.
9. **Dialogs.** Cancel gets `autoFocus` on every destructive confirm, so Enter does not destroy
   anything. Esc always closes (including the password reveal — §7.3). Every `DialogContent` has a
   `DialogTitle`; `DialogDescription` carries the consequence sentence so it is announced with the
   title.
10. **Tables.** Each gets `<caption className="sr-only">`. Sortable headers use the existing
    `data-table-column-header` (it renders a real `<button>` with the sort state).
11. **Filter chips** are `<Button aria-pressed>`, not styled divs; the group is wrapped in
    `role="group" aria-label="Filter by severity"`.
12. **Form fields** all have a real `<Label htmlFor>`. Inline errors are tied with
    `aria-describedby` and the field gets `aria-invalid`.
13. **External links** (CVE) carry `rel="noopener noreferrer"` and an accessible name ending in
    "(opens in a new tab)".
14. **Disabled + tooltip.** A `disabled` button does not emit pointer events, so the permission and
    "not while GC runs" tooltips must wrap a `<span tabIndex={0}>`. Without it the control is
    unexplained, which is worse than hiding it.

---

## 12. Files

### New

```
apps/web/src/components/shared/notice.tsx
apps/web/src/components/shared/severity-badge.tsx
apps/web/src/components/shared/agent-status-badge.tsx
apps/web/src/components/shared/disk-usage-bar.tsx
apps/web/src/hooks/use-is-admin.ts
apps/web/src/services/queries/agent.queries.ts
apps/web/src/features/registry/components/registry-tabs.tsx
apps/web/src/features/registry/pages/registry-maintenance-page.tsx
apps/web/src/features/registry/pages/registry-users-page.tsx
apps/web/src/features/registry/components/maintenance/overview-card.tsx
apps/web/src/features/registry/components/maintenance/garbage-collection-card.tsx
apps/web/src/features/registry/components/maintenance/storage-card.tsx
apps/web/src/features/registry/components/maintenance/stale-uploads-card.tsx
apps/web/src/features/registry/components/maintenance/read-only-card.tsx
apps/web/src/features/registry/components/maintenance/logs-card.tsx
apps/web/src/features/registry/components/maintenance/agent-settings-card.tsx
apps/web/src/features/registry/components/maintenance/restart-card.tsx
apps/web/src/features/registry/components/registry-user-password-dialog.tsx
apps/web/src/features/docker/components/pull-activity-card.tsx
apps/web/src/features/docker/components/scan-findings-table.tsx
apps/web/src/features/docker/components/tag-scan-status.tsx
apps/web/src/features/dashboard/components/registry-agents-card.tsx
```

### Changed

```
apps/web/src/styles/globals.css                    severity tokens (§3.1)
apps/web/src/lib/formatters.ts                     formatRelativeTimeOr, formatDuration (§9)
apps/web/src/router/route-paths.ts                 two paths (§2.1)
apps/web/src/router/routes.tsx                     two routes (§2.1)
apps/web/src/services/queries/query-keys.ts        agent + docker keys (§7.1)
apps/web/src/components/layout/sidebar.tsx         status dot on connection links (§2.2)
apps/web/src/components/layout/breadcrumbs.tsx     labels (§2.4)
apps/web/src/components/shared/index.ts            new exports
apps/web/src/features/settings/components/registry-connections.tsx   §6.1
apps/web/src/features/settings/components/retention-policies.tsx     §6.7
apps/web/src/features/settings/pages/settings-page.tsx               tab overflow fix (§10)
apps/web/src/features/registry/pages/registry-page.tsx               tabs + notices (§6.2)
apps/web/src/features/docker/pages/docker-repository-detail-page.tsx §6.5
apps/web/src/features/docker/pages/docker-tag-detail-page.tsx        §6.6
apps/web/src/features/dashboard/pages/dashboard-page.tsx             §6.8
apps/web/src/features/rbac/pages/users-page.tsx                      one cross-link line (§6.4)
```

---

## 13. Review checklist

Before calling this done, on a 375 px viewport and a 1440 px viewport, in **both** themes:

- [ ] Every new screen renders correctly with no agent, with an offline agent, with an
      unauthorized agent, and with an agent missing `scan` / `users` / `gc`.
- [ ] `Clean` never appears on a tag that has not been scanned.
- [ ] No `formatRelativeTime` call can receive `undefined`/`null` — a `null` renders
      "over 56 years ago", not an error, so grep for it rather than trusting the page to crash.
- [ ] The agent settings card and the GC schedule block both send a complete `IAgentSettings`.
- [ ] The tag row's Scan button is not inside the row `<button>`.
- [ ] Every icon-only button has an `aria-label`.
- [ ] Tab through the maintenance page: every control is reachable and visibly focused, including
      the log viewer.
- [ ] As a non-admin: every write control is visible, disabled and explains itself.
- [ ] Severity colours are legible in dark mode (the current ones are not).

---

## 14. Open questions

**Q1 — Testing an agent before the connection exists.** `POST /api/settings/registries/:id/agent/test`
needs a saved connection, so the **Test agent** button is dead on the create path — exactly when it
is most useful. A keyless `POST /api/settings/registries/agent/test` taking `{ url, apiKey }` would
fix it. Until then the button is disabled on create with a tooltip.

**Q2 — Should `Role.Maintainer` get agent write access?** This spec makes every agent write
admin-only. GC and scans are arguably maintenance, not administration; registry logins and the API
key clearly are not. A split (Maintainer: GC, dry run, scan, purge uploads, read-only; Admin:
users, agent settings, restart, delete repository) is defensible. Product call.

**Q3 — Linking storage rows to repositories.** `IAgentRepositoryStorage.name` is the registry's
repository name; Vault's routes take `repositoryId`. Without a name→id lookup the storage table
cannot link to the repository page. Either the API returns the Vault id alongside the name, or the
web app resolves it from the already-loaded repositories list for that connection (extra request,
paginated). Spec'd as plain text for now.

**Q4 — Weekly GC has no weekday.** `IAgentSettings` has `gcSchedule: 'off'|'daily'|'weekly'` and
`gcHour`, but nothing says which day a weekly run lands on. The UI currently cannot tell the
operator. Either add `gcWeekday` or document the fixed day so the helper text can state it.

**Q5 — Dashboard offline rows have no timestamp.** `IAgentOverviewItem` carries no `lastSeenAt`, so
"Last reached 3 hours ago" has to be joined from the connections query. Adding `lastSeenAt` to the
overview item would make the card self-sufficient.

**Q6 — Retention `notPulledForDays` across connections.** A policy targets a registry *type*, but
pull data only exists on connections that have an agent. Does the API skip agent-less connections
silently, fail the run, or treat "no data" as "not pulled" (which would delete everything)? The
helper text in §6.7 promises "skips connections without an agent" — that promise needs confirming
before it ships.

**Q7 — Pull attribution for multi-arch tags.** `agent/API.md:101` says Vault attributes digest
pulls to tags. When two tags share a digest (e.g. `latest` and `v1.0.8`, which
`screenshots/docker-3.png` shows happening), is the pull counted once per tag or split? The
per-tag column's meaning depends on the answer; the UI states it as "pulls of this tag".

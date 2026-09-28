# Registry Vault Agent — contract

The agent is a single Go binary that runs next to a CNCF Distribution registry
(`registry:3`) and does what the Registry HTTP API cannot: garbage collection,
disk accounting, repository directory removal, upload purging, maintenance
mode, process health, user management, pull/push accounting and vulnerability
scans.

This file is the contract between the agent (`agent/`, Go) and Registry Vault
(`apps/api`, NestJS). Change it here first; both sides follow it.

## Topology

```
            :5000 (public registry)          :5080 (management API)
                  │                                   │
        ┌─────────▼───────────────────────────────────▼─────────┐
        │                     registry-agent                     │
        │  auth gate · write gate · event log · supervisor · API │
        └─────────┬──────────────────────────────────┬──────────┘
                  │ reverse proxy                     │ exec
        127.0.0.1:5001                         registry garbage-collect,
        registry serve (child process)         trivy image …
```

- The agent is PID 1's child (under `tini`) and **supervises** the registry: it
  starts `registry serve <config>`, restarts it if it exits, and forwards
  SIGTERM/SIGINT for a clean shutdown.
- In the all-in-one image the agent additionally supervises one extra command
  (Registry Vault) given by `AGENT_EXTRA_COMMAND`, restarting it on exit and
  stopping it on shutdown. Its stdout/stderr are passed through.
- The registry listens only on `127.0.0.1:5001`, with **no auth of its own**.
  Every external request goes through the agent on `:5000`.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_API_KEY` | **required** | Bearer key for the management API and the service principal on `:5000`. The agent exits with an error when it is missing or shorter than 16 characters. Never logged. |
| `AGENT_LISTEN` | `:5000` | Public registry address (proxy). |
| `AGENT_API_LISTEN` | `:5080` | Management API address. |
| `AGENT_DATA_DIR` | `/var/lib/registry-agent` | Agent state: users, event log, scan results, Trivy cache. Mount a volume. |
| `REGISTRY_CONFIG` | `/etc/distribution/config.yml` | Registry config file. The agent reads `storage.filesystem.rootdirectory` from it. |
| `REGISTRY_STORAGE_ROOT` | from config, else `/var/lib/registry` | Registry storage root (overrides the config value). |
| `REGISTRY_INTERNAL_ADDR` | `127.0.0.1:5001` | Where the child registry listens. The agent sets `REGISTRY_HTTP_ADDR` for the child to this. |
| `REGISTRY_AUTH` | `htpasswd` | `htpasswd` — the agent authenticates every `:5000` request against its user store. `none` — anonymous pull and push (only for a registry that is not reachable from outside). |
| `REGISTRY_HTPASSWD_IMPORT` | unset | Path of an existing htpasswd file. On start, users in it that are not yet in the store are imported with role `push`. Lets an existing registry keep its logins. |
| `AGENT_SERVICE_USER` | `registry-vault` | Username of the service principal: Basic auth with this user and `AGENT_API_KEY` as the password has `admin` role on `:5000`. Used by Registry Vault itself. |
| `AGENT_EXTRA_COMMAND` | unset | All-in-one only: a command line to supervise alongside the registry. |
| `AGENT_GC_RETRY_AFTER` | `30` | Seconds sent in `Retry-After` when a write is rejected during GC or maintenance. |
| `AGENT_TRUSTED_PROXIES` | `127.0.0.0/8,::1/128` | Comma-separated CIDR blocks (or bare addresses) of the proxies in front of the agent. `X-Forwarded-For` and `X-Forwarded-Proto` are only believed when the direct peer is one of them; from anyone else they are an unauthenticated claim and are replaced with what the agent can see. Empty trusts nobody. |
| `AGENT_EVENT_RETENTION_DAYS` | `30` | Events older than this are pruned from the log. |
| `TRIVY_ENABLED` | `true` when a `trivy` binary is on `PATH` | Scanning on/off. |
| `AGENT_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |
| `REGISTRY_BINARY` | `registry` on `PATH` | The Distribution binary to supervise and run GC with. |

Distribution treats every `REGISTRY_<SECTION>_…` variable as a config
override, and several agent variables live in that namespace. The agent strips
its own variables from the environment of every `registry` process it starts
(`registryOnlyEnv` in `cmd/registry-agent/main.go`); any new agent variable
named `REGISTRY_*` must be added there.

The agent always runs the registry with deletes enabled
(`REGISTRY_STORAGE_DELETE_ENABLED=true` in the child's environment).

## Registry endpoint (`:5000`)

A transparent reverse proxy to the child registry, streaming bodies in both
directions (no buffering: blobs are gigabytes). The incoming `Host` is kept and
`X-Forwarded-Proto` / `X-Forwarded-For` are set, so the registry's `Location`
headers point back through the agent.

An inbound `X-Forwarded-Proto` / `X-Forwarded-For` is only carried through when
the direct peer is listed in `AGENT_TRUSTED_PROXIES` (loopback by default).
That is what lets a TLS terminator in front of the agent tell it the public
scheme, without letting an arbitrary client claim a scheme or put someone
else's address in the event log. **Deployments behind a terminator must set
`AGENT_TRUSTED_PROXIES` to the terminator's address**, or the registry will
generate `http://` upload URLs and every event will be attributed to the
terminator.

### Authentication (`REGISTRY_AUTH=htpasswd`)

- Basic auth only. Missing or wrong credentials → `401` with
  `WWW-Authenticate: Basic realm="Registry Vault"` and a Distribution-style
  JSON error body (`{"errors":[{"code":"UNAUTHORIZED",...}]}`).
- `GET /v2/` with valid credentials → proxied (Docker uses it as a login probe).
- Roles:
  - `pull` — `GET`/`HEAD` on everything under `/v2/`.
  - `push` — `pull` + `POST`/`PUT`/`PATCH` (uploads, manifest puts).
  - `admin` — `push` + `DELETE` + `GET /v2/_catalog`.
  - The catalog is `admin`-only; `pull`/`push` users get `401` there.
- A request above the caller's role gets `401` with Distribution code `DENIED`
  (the message names the role); missing or wrong credentials get `401`
  `UNAUTHORIZED`.
- With `REGISTRY_AUTH=none`, anonymous callers have the `push` role (no
  `DELETE`, no catalog) and 401s carry no `WWW-Authenticate`. The service
  principal is still recognised, so Registry Vault must authenticate as it
  (Basic `AGENT_SERVICE_USER` / `AGENT_API_KEY`) to delete and list.
- The service principal (`AGENT_SERVICE_USER` / `AGENT_API_KEY`) is `admin`.
- Passwords are bcrypt-verified; a successful verification is cached in memory
  for 60 s keyed by a SHA-256 of the credentials so a pull with hundreds of
  requests does not pay bcrypt each time.

### Write gate

While GC runs, while a repository directory is being removed, or while
maintenance mode is on, every `POST`/`PUT`/`PATCH`/`DELETE` under `/v2/` gets
`503` with `Retry-After: AGENT_GC_RETRY_AFTER` and a body
`{"errors":[{"code":"UNAVAILABLE","message":"registry is in maintenance: <reason>"}]}`.
Reads are never gated. A GC waits for in-flight writes to finish (up to 60 s)
before it starts.

### Event capture

After the upstream response is sent, the agent records an event when:

| Request | Status | Event `type` |
|---|---|---|
| `GET /v2/<name>/manifests/<ref>` | 200 | `pull` |
| `PUT /v2/<name>/manifests/<ref>` | 201 | `push` |
| `DELETE /v2/<name>/manifests/<ref>` | 202 | `delete` |

`HEAD` is not a pull (clients probe with it). A pull of a multi-arch image
fetches the index by tag and then platform manifests by digest; each is an
event, and Registry Vault attributes digest pulls to tags. Requests by the
service principal are recorded with `actor: "registry-vault"` so Registry Vault
can ignore its own sync traffic.

## Management API (`:5080`)

- Every route except `GET /healthz` requires `Authorization: Bearer <AGENT_API_KEY>`
  (constant-time compare). Wrong or missing → `401 {"error":"unauthorized"}`.
- JSON in and out, `Content-Type: application/json`. Times are RFC 3339 UTC.
  Sizes are bytes (int64).
- Errors: `{"error":"<code>","message":"<human readable>"}` with a 4xx/5xx
  status. Codes: `unauthorized`, `not_found`, `conflict` (another job running,
  repository not empty), `unavailable` (feature disabled), `bad_request`,
  `internal`.
- Base path `/api/v1`.

### Health and info

`GET /healthz` — no auth. `200 {"status":"ok"}` when the agent is up
(regardless of the registry child).

`GET /api/v1/info`
```json
{
  "version": "1.0.0",
  "registryVersion": "3.0.0",
  "features": ["gc", "storage", "repositories", "uploads", "maintenance", "logs", "users", "events", "scan"],
  "auth": "htpasswd",
  "storageRoot": "/var/lib/registry"
}
```
`scan` is listed only when Trivy is enabled; `users` only when `auth` is
`htpasswd`.

`GET /api/v1/health`
```json
{
  "registry": { "running": true, "pid": 42, "startedAt": "…", "restarts": 0, "lastExit": null },
  "extra":    { "running": true, "pid": 43, "startedAt": "…", "restarts": 0, "lastExit": null },
  "maintenance": { "readOnly": false, "reason": null, "since": null },
  "gc": { "state": "idle" },
  "disk": { "totalBytes": 0, "usedBytes": 0, "freeBytes": 0, "usedPercent": 0 }
}
```
`extra` is `null` when no extra command is configured. `lastExit` is
`{"code": 1, "at": "…"}` or `null`; a negative code means the process was
killed by a signal.

`POST /api/v1/registry/restart` → `202 {"restarting": true}`. Refused with
`409` while GC runs.

`GET /api/v1/logs?source=registry|agent|extra&lines=200` → `200 {"source":"registry","lines":["…"]}`.
The agent keeps the last 2000 lines of each source in memory. `lines` max 2000.

### Storage

`GET /api/v1/storage` — computed by walking the storage root; cached for 60 s
(`?refresh=true` forces a walk).
```json
{
  "computedAt": "…",
  "disk": { "totalBytes": 0, "usedBytes": 0, "freeBytes": 0, "usedPercent": 0 },
  "registry": { "totalBytes": 0, "blobBytes": 0, "uploadBytes": 0, "repositoryCount": 0 },
  "repositories": [
    { "name": "app", "exclusiveBytes": 0, "sharedBytes": 0, "layerCount": 0, "manifestCount": 0 }
  ]
}
```
- `disk` is the filesystem holding the storage root (statfs).
- A repository's blobs are those linked under `repositories/<name>/_layers`
  and `_manifests/revisions`. `exclusiveBytes` counts blobs only this
  repository links (what deleting it would free after GC); `sharedBytes`
  counts blobs other repositories also link.
- `uploadBytes` is the total under every `_uploads` directory.

### Garbage collection

`POST /api/v1/gc` body `{"dryRun": false}` → `202` with a job, or `409` if a GC
is already running.

`GET /api/v1/gc` → the current or most recent job, or `404 not_found` when no
GC has ever run. `GET /api/v1/gc/history` → `{"jobs": [...]}`, the last 20
jobs, newest first.

```json
{
  "id": "gc_20260928T184000Z",
  "state": "queued|running|succeeded|failed",
  "dryRun": false,
  "startedAt": "…",
  "finishedAt": "…",
  "usedBytesBefore": 0,
  "usedBytesAfter": 0,
  "freedBytes": 0,
  "blobsDeleted": 0,
  "manifestsDeleted": 0,
  "error": null,
  "output": ["last 200 lines of garbage-collect output"]
}
```

A non-dry run:
1. closes the write gate (reason `garbage collection`) and waits for in-flight writes;
2. runs `registry garbage-collect --delete-untagged <config>`;
3. removes repository directories left with no tags and no manifests;
4. reopens the gate — always, even on failure;
5. recomputes storage.

A dry run passes `--dry-run`, leaves the gate open, and reports what would be
deleted in `blobsDeleted` / `manifestsDeleted` with `freedBytes` estimated from
the blob sizes. Only one GC job runs at a time; job history is persisted in
`AGENT_DATA_DIR`.

`--delete-untagged` is required: without it, deleting a multi-arch image frees
nothing, because its platform manifests stay referenced. It is safe on
`registry:3` only — `registry:2` deletes platform manifests of images that are
still tagged. The agent refuses to start GC when `registry --version` reports a
major version below 3 (`409`, message explains why).

### Repositories

`DELETE /api/v1/repositories/{name}` (name may contain `/`, URL-encoded or as
path segments) removes `repositories/<name>` from storage under the write gate,
so the registry stops listing it. `409 conflict` when it still has tags,
unless `?force=true`. `404` when it does not exist. `200 {"removed": "app"}`.
Space returns on the next GC.

### Uploads

`GET /api/v1/uploads?olderThanHours=24` → uploads left by interrupted pushes:
```json
{ "totalBytes": 0, "uploads": [ { "repository": "app", "id": "uuid", "startedAt": "…", "bytes": 0 } ] }
```
`POST /api/v1/uploads/purge` body `{"olderThanHours": 24}` (minimum 1) →
`200 {"purged": 3, "freedBytes": 0}`. Uploads younger than the threshold are
never touched (they may be in progress).

### Maintenance

`GET /api/v1/maintenance` → `{"readOnly": false, "reason": null, "since": null}`.
`PUT /api/v1/maintenance` body `{"readOnly": true, "reason": "backup"}` →
the new state. Persisted across restarts. GC and repository removal use the
same gate but do not change this state.

### Users (`REGISTRY_AUTH=htpasswd`)

Stored in `AGENT_DATA_DIR/users.json` (bcrypt cost 10), written atomically.

`GET /api/v1/users` → `{"users":[{"username":"ci","role":"push","createdAt":"…","updatedAt":"…","lastUsedAt":"…"}]}`
(never includes hashes; `lastUsedAt` may be `null`).

`POST /api/v1/users` body `{"username":"ci","role":"push","password":"optional"}`
→ `201 {"user":{…},"password":"<only when generated>"}`. When `password` is
omitted the agent generates a 24-character one and returns it once.
Usernames: `^[a-z0-9][a-z0-9._-]{1,63}$`; the service username is reserved.
Passwords: minimum 12 characters. `409` if the user exists.

`PATCH /api/v1/users/{username}` body `{"role":"pull"}` and/or
`{"password":"…"}` or `{"resetPassword": true}` (returns a generated password
once) → `200 {"user":{…},"password":"<only when generated>"}`.

`DELETE /api/v1/users/{username}` → `204`.

Changes take effect immediately (the auth cache is cleared).

### Events

The event log is an append-only file in `AGENT_DATA_DIR` with a monotonically
increasing `seq`. Registry Vault polls it; nothing is pushed to Vault, so the
agent never needs to reach Vault.

`GET /api/v1/events?after=<seq>&limit=500` (`limit` max 1000):
```json
{
  "events": [
    {
      "seq": 101,
      "type": "pull",
      "repository": "app",
      "reference": "1.0.8",
      "digest": "sha256:…",
      "actor": "ci",
      "remoteAddr": "203.0.113.4",
      "userAgent": "docker/27.0 …",
      "at": "…"
    }
  ],
  "nextAfter": 101,
  "oldestSeq": 1
}
```
- `reference` is the tag or digest the client asked for; `digest` is the
  `Docker-Content-Digest` of the response.
- `actor` is the username, `registry-vault` for the service principal, or
  `anonymous` with `REGISTRY_AUTH=none`.
- When `after` is older than `oldestSeq` (events were pruned), the response
  carries `"gap": true` so Vault knows counts since then are incomplete.

### Scans (Trivy)

`POST /api/v1/scans` body `{"repository":"app","reference":"1.0.8","platform":"linux/amd64"}`
(`platform` optional, default `linux/amd64`, falling back to the first
platform of the index) → `202 {"scan":{…}}`.

The `platform` in the response is the platform that was **actually** scanned,
read from the index entry or from the image's own config blob — never an echo
of the request. The fallback applies only when `platform` was omitted: a
platform named explicitly and not found is a `failed` scan whose `error` says
what the image is instead, because a report labelled with an architecture
nobody scanned is worse than no report. Scans run one at a time from a
queue (Trivy is heavy); up to 50 may be queued, then `409`.

`GET /api/v1/scans/{id}` →
```json
{
  "id": "scan_…",
  "repository": "app",
  "reference": "1.0.8",
  "digest": "sha256:…",
  "platform": "linux/amd64",
  "state": "queued|running|succeeded|failed",
  "queuedAt": "…",
  "startedAt": "…",
  "finishedAt": "…",
  "error": null,
  "summary": { "critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0 },
  "vulnerabilities": [
    {
      "id": "CVE-2024-0001",
      "pkgName": "openssl",
      "installedVersion": "3.0.1",
      "fixedVersion": "3.0.2",
      "severity": "CRITICAL",
      "title": "…",
      "primaryUrl": "https://…"
    }
  ]
}
```
`GET /api/v1/scans?repository=app&reference=1.0.8` → `{"scans": [...]}`, the
latest scans for that reference (newest first, max 10, without
`vulnerabilities`).

Trivy scans the image from the internal registry
(`trivy image --insecure --format json 127.0.0.1:5001/<repo>@<digest>`) with its
cache in `AGENT_DATA_DIR/trivy`. The vulnerability database is downloaded on
first use, which needs internet access; a failed download is a `failed` scan
with the Trivy error, not an agent crash. Results are kept on disk for the last
500 scans.

# registry-agent

A single Go binary that runs next to a CNCF Distribution registry (`registry:3`)
and does what the Registry HTTP API cannot: garbage collection, disk
accounting, repository directory removal, upload purging, maintenance mode,
process health, user management, pull/push accounting and vulnerability scans.

It also **supervises** the registry, and sits in front of it as an
authenticating, streaming reverse proxy.

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

**[API.md](API.md) is the contract.** This file is how to build and run it.

## Why it exists

The registry it fronts holds multi-arch images built with buildx (amd64 +
arm64, with provenance attestations). Three measured facts shape the design:

- Deleting a multi-arch image's index through the Registry API and then running
  a plain `registry garbage-collect` frees **nothing**: the index is gone, but
  its platform manifests are still referenced.
- On `registry:2`, `garbage-collect --delete-untagged` **destroys still-tagged
  multi-arch images** — every platform manifest 404s afterwards.
- On `registry:3`, `--delete-untagged` frees exactly the deleted image and
  leaves the kept ones intact.

So the agent always passes `--delete-untagged`, and **refuses to collect** when
`registry --version` reports a major version below 3.

## Build

### The image

```bash
# this machine's platform
docker buildx build --load -t kianfar/registry-vault-registry agent/

# both architectures, pushed
docker buildx build --platform linux/amd64,linux/arm64 \
  -t kianfar/registry-vault-registry:1.0.0 --push agent/
```

The image is alpine with `tini` as PID 1, and carries four things: the agent,
the `registry` binary and a config derived from `registry:3`, and `trivy` from
`aquasec/trivy`. The `agent-build` stage is self-contained — it compiles on
`$BUILDPLATFORM` and cross-compiles for `$TARGETPLATFORM` — so the all-in-one
image can reuse it.

Build arguments: `GO_VERSION`, `ALPINE_VERSION`, `REGISTRY_IMAGE`,
`TRIVY_IMAGE`, `AGENT_VERSION` (compiled into `GET /api/v1/info`).

### The binary alone

```bash
cd agent
go vet ./...
go test ./...
CGO_ENABLED=0 go build -trimpath -o registry-agent ./cmd/registry-agent
```

Go 1.27, no cgo. Dependencies: `golang.org/x/crypto` (bcrypt),
`golang.org/x/sys` (statfs) and `gopkg.in/yaml.v3` (reading the registry's
config). Everything else is the standard library.

## Run

```bash
docker run -d --name registry \
  -p 5000:5000 -p 5080:5080 \
  -e AGENT_API_KEY="$(openssl rand -hex 24)" \
  -v registry-storage:/var/lib/registry \
  -v registry-agent-data:/var/lib/registry-agent \
  kianfar/registry-vault-registry
```

Then create a login and push:

```bash
curl -s -X POST -H "Authorization: Bearer $AGENT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ci","role":"push"}' \
  http://localhost:5080/api/v1/users          # returns a generated password once

docker login localhost:5000 -u ci
docker push localhost:5000/app:1.0.0
```

Both volumes matter: `/var/lib/registry` is the images, and
`/var/lib/registry-agent` is the users, the event log, the job history, the
maintenance state and Trivy's vulnerability database.

## Configuration

Everything is an environment variable. `AGENT_API_KEY` is the only one without
a default — the agent exits non-zero with a clear message when it is missing or
shorter than 16 characters. It is never logged, and it is compared in constant
time.

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_API_KEY` | **required** | Bearer key for the management API, and the service principal's password on `:5000`. At least 16 characters. |
| `AGENT_LISTEN` | `:5000` | Public registry address (the proxy). |
| `AGENT_API_LISTEN` | `:5080` | Management API address. |
| `AGENT_DATA_DIR` | `/var/lib/registry-agent` | Agent state: users, event log, GC history, maintenance state, scan results, Trivy cache. Mount a volume. |
| `REGISTRY_CONFIG` | `/etc/distribution/config.yml` | The registry's config file. The agent reads `storage.filesystem.rootdirectory` from it and passes it to `registry serve` and `registry garbage-collect`. |
| `REGISTRY_STORAGE_ROOT` | from the config, else `/var/lib/registry` | Storage root, overriding the config value. |
| `REGISTRY_INTERNAL_ADDR` | `127.0.0.1:5001` | Where the child registry listens. The agent sets `REGISTRY_HTTP_ADDR` to this for the child. |
| `REGISTRY_AUTH` | `htpasswd` | `htpasswd`: every `:5000` request is authenticated against the agent's user store. `none`: anonymous pull and push (only for a registry that is not reachable from outside). |
| `REGISTRY_HTPASSWD_IMPORT` | unset | Path of an existing htpasswd file. On start, users in it that the store does not have yet are imported with role `push`. Only bcrypt entries can be imported. |
| `AGENT_SERVICE_USER` | `registry-vault` | The service principal's username. Basic auth with this user and `AGENT_API_KEY` is `admin` on `:5000`, and its traffic is recorded with `actor: "registry-vault"`. |
| `AGENT_EXTRA_COMMAND` | unset | All-in-one only: a command line supervised alongside the registry. |
| `AGENT_GC_RETRY_AFTER` | `30` | Seconds in `Retry-After` when a write is refused during GC or maintenance. |
| `AGENT_TRUSTED_PROXIES` | `127.0.0.0/8,::1/128` | CIDR blocks (or bare addresses) of the proxies in front of the agent, comma-separated. Their `X-Forwarded-For` and `X-Forwarded-Proto` are believed; everyone else's are ignored. Empty trusts nobody. |
| `AGENT_EVENT_RETENTION_DAYS` | `30` | Events older than this are pruned. |
| `TRIVY_ENABLED` | `true` when `trivy` is on `PATH` | Scanning on or off. Setting it without a `trivy` binary logs a warning and leaves scanning off. |
| `AGENT_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |
| `REGISTRY_BINARY` | `registry` (from `PATH`) | The registry executable, for an unusual layout. |

Anything else in the environment is passed through to the registry child, so
`REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY` and friends still work. The
variables in the table above are **not** passed through: Distribution reads
`REGISTRY_<SECTION>_…` as configuration overrides, and `REGISTRY_STORAGE_ROOT`
alone would stop it parsing its config at all. The child always gets
`REGISTRY_STORAGE_DELETE_ENABLED=true`, because every management operation
depends on deletes.

## Roles

| Role | May |
|---|---|
| `pull` | `GET` and `HEAD` under `/v2/` |
| `push` | `pull`, plus `POST`, `PUT` and `PATCH` |
| `admin` | `push`, plus `DELETE` and `GET /v2/_catalog` |

Passwords are bcrypt (cost 10) in `users.json`, written atomically and never
stored or logged in clear. A successful verification is cached for 60 seconds
keyed by a SHA-256 of the credentials, so a pull with hundreds of requests pays
bcrypt once. Changing or deleting a user clears that cache immediately.

## Operating notes

- **Garbage collection.** `POST /api/v1/gc` with `{"dryRun": true}` first: it
  reports what would go without touching anything. A real run closes the write
  gate (pushes get `503` with `Retry-After`), waits up to 60 s for in-flight
  writes, runs the collector, removes repository directories left with no tags
  and no manifests, and reopens the gate — always, including on failure and on
  a panic. Only one collection runs at a time.
- **Maintenance.** `PUT /api/v1/maintenance` uses the same gate and survives a
  restart. Reads are never gated.
- **Reverse proxy.** Bodies stream in both directions and are never buffered,
  the client's `Host` is preserved, and `X-Forwarded-Proto` from a TLS
  terminator in front of the agent is honoured — that is what makes the
  registry's `Location` headers point back through the agent over HTTPS.
  Forwarded headers count only from a peer in `AGENT_TRUSTED_PROXIES`, so
  **put your terminator's address there**; by default only loopback is
  trusted, and a direct client's forwarded headers are replaced with what the
  agent sees for itself.
- **Events.** `GET /api/v1/events?after=<seq>` is a poll; the agent never calls
  out to Registry Vault. When events have been pruned past what the caller
  asked for, the response carries `"gap": true`.
- **Logs.** The last 2000 lines of the agent, the registry and the extra
  command are kept in memory and served by `GET /api/v1/logs`; everything also
  goes to the container's stdout.

## Tests

```bash
cd agent
go vet ./... && go test -race ./...
```

The suites cover the role matrix and the auth gate, which peers' forwarded
headers are believed, the write gate (including that it reopens when the work
under it panics), the event capture rules, event paging over a log with holes
and the gap flag, the user store, storage accounting on a fake storage tree,
upload age filtering and purging, repository removal, the empty-repository
sweep's refusal to delete a push in progress, scan platform resolution, and the
supervisor's restart loop and its promise never to log a child's environment or
command line.

What they do not cover: the Trivy run itself, the collector's own behaviour and
the management API's handlers — those are exercised against a real registry, as
described in API.md.

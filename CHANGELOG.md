# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-28

### Added

- **Registry agent** — a companion process that runs beside a `registry:3`
  container, supervises it and fronts it as an authenticating, streaming
  reverse proxy on `:5000`, with a management API on `:5080`. It adds what the
  Registry HTTP API has no endpoint for: garbage collection, disk and
  per-repository storage accounting, repository directory removal, stale upload
  purging, read-only maintenance mode, health, logs and registry restart,
  `docker login` user management, pull/push events and Trivy vulnerability
  scans. See [agent/README.md](agent/README.md) and the contract in
  [agent/API.md](agent/API.md).
- **Two new images**: `kianfar/registry-vault-registry` (registry + agent +
  Trivy) and `kianfar/registry-vault-aio` (all of it plus Registry Vault in one
  container, registering its own registry on every start).
  `kianfar/registry-vault` is unchanged in use. Example compose files
  (`docker-compose.aio.yml`, `docker-compose.registry.yml`) and a combined build
  definition (`docker-bake.hcl`) ship with them.
- **Registry → Maintenance** page: health and disk, storage per repository,
  garbage collection with dry run and history, stale uploads, read-only mode,
  agent logs, registry restart and per-connection agent settings.
- **Registry users** page: the `docker login` accounts on an agent-backed
  registry, with `pull` / `push` / `admin` roles. An existing htpasswd file can
  be imported on start with `REGISTRY_HTPASSWD_IMPORT`.
- **Pull statistics and vulnerability views** for Docker tags, from the agent's
  event log and Trivy. Agent events also make a sync near-instant.
- **Retention by pulls**: delete Docker tags nobody pulled for N days. A
  repository is skipped rather than judged when its registry has no agent, or
  its agent is offline or stale; a gap in pull history restarts the observation
  window instead of disabling the rule.
- **Retention "run GC after"**, and **scheduled garbage collection** (daily or
  weekly, at a chosen hour) per registry connection.
- **Low-disk banner** on the dashboard for any registry past its warning
  threshold (85% used by default, configurable per connection).
- `AGENT_TRUSTED_PROXIES` on the agent: the proxies whose `X-Forwarded-For` and
  `X-Forwarded-Proto` are believed. Defaults to loopback only — deployments
  behind a TLS terminator must list it, or the registry hands out `http://`
  upload URLs and every pull is attributed to the proxy.

### Changed

- Retention **"Run Now"** deletes on the registry. It previously removed local
  rows only: nothing left the registry, no space was freed, and the next sync
  brought every tag back. It now goes through the same registry path as a manual
  cleanup and honours the exclude-tag pattern.
- Deleting N Docker tags resolves the repository once and deletes once per
  digest, instead of re-resolving per tag. A 60-tag multi-arch cleanup went from
  2250 requests to 121.
- Sync prunes repositories that are missing from the registry's catalog, so ones
  removed on the registry host no longer stay listed; a tag-listing error no
  longer reads as "no tags".
- Cleanup results report failures instead of "Cleaned up 0", and say that Docker
  space returns only after garbage collection.
- A registry connection can hold an agent URL and key. The key is write-only —
  encrypted at rest, never returned, never logged — and changing the URL
  requires entering the key again, so a stored key is never sent to a new
  address. "Test agent" probes a connection before it is saved.
- Settings has a **Storage** tab; credentials are edited with their connection
  under **Registries**.
- Vulnerability scans report the platform actually scanned, read from the
  image's own config. Asking for a platform the image does not have fails the
  scan rather than relabelling it.

### Fixed

- A retention policy that set no keep-last-N and no older-than rule selected
  every version. It is now refused.
- The registry fetch timeout was cleared once response headers arrived, so a
  stalled body could hang a sync or a delete indefinitely. The timeout now
  covers the body.

### Security

- Roles are enforced server-side on every route, with **writes denied by
  default**: anything that is not a `GET` or `HEAD` requires an administrator
  unless the route opts out, so a write route added later is closed until
  someone opens it.
  - **Admin**: settings, credentials, retention, webhooks, users, cleanup and
    repair, whole-repository and whole-package deletes, and every
    administrative agent action (maintenance mode, registry restart, registry
    users, agent settings, agent logs, repository directory removal).
  - **Maintainer**: delete tags and versions (single and bulk), request scans,
    run garbage collection, purge stale uploads.
  - **Reader**: read-only.
- A mixed bulk delete is checked in full before anything is deleted, so a
  maintainer's request that also names a whole repository is refused outright
  rather than half-applied.
- The caller is resolved from the database on every request instead of from the
  token, so a demotion or a deactivation takes effect immediately rather than
  when a 24-hour token expires.
- Changing your own password requires the current one. The last administrator
  who can still sign in cannot be demoted, deactivated or deleted.

### Upgrade notes

See [Upgrade notes](README.md#upgrade-notes) in the README. In short: the agent
images read an existing `registry:2` storage volume unchanged (add a second
volume for the agent's own state); import existing logins with
`REGISTRY_HTPASSWD_IMPORT`; set the connection's agent URL and key in
Settings → Registries; readers lose any write access they previously had;
`docker login` credentials are now the agent's; and a Vault connection to an
agent registry running with `REGISTRY_AUTH=none` must authenticate as the
service principal (`AGENT_SERVICE_USER` / `AGENT_API_KEY`) to delete and list.

## [1.0.5] - 2026-08-06

### Fixed

- Docker tags are deleted by their own digest rather than a platform child of a
  multi-arch index.

[1.1.0]: https://github.com/navid-kianfar/registry-vault/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/navid-kianfar/registry-vault/compare/v1.0.4...v1.0.5

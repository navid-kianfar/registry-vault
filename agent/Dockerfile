# syntax=docker/dockerfile:1
#
# kianfar/registry-vault-registry — a CNCF Distribution registry with the
# Registry Vault agent in front of it.
#
#   :5000  public registry (authenticating reverse proxy)
#   :5080  management API (agent/API.md)
#
# Build for the host platform:
#   docker buildx build --load -t kianfar/registry-vault-registry agent/
#
# Build both architectures:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t kianfar/registry-vault-registry:1.0.0 --push agent/
#
# The `agent-build` stage is self-contained: the all-in-one image reuses it.

ARG GO_VERSION=1.27
ARG ALPINE_VERSION=3.22
ARG REGISTRY_IMAGE=registry:3
ARG TRIVY_IMAGE=aquasec/trivy:0.74.0

# ---- Agent build -------------------------------------------------------------
# Compiles on the build machine's own platform and cross-compiles for the
# target, which is far faster than emulating the target under QEMU.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS agent-build

WORKDIR /src

# Dependencies first, so a source-only change does not re-download them.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY cmd ./cmd
COPY internal ./internal

ARG TARGETOS
ARG TARGETARCH
ARG AGENT_VERSION=1.0.0

# CGO off: the binary must run on a bare alpine with no libc lookups.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath \
      -ldflags "-s -w -X main.version=${AGENT_VERSION}" \
      -o /out/registry-agent ./cmd/registry-agent

# ---- Upstream binaries -------------------------------------------------------
# Both are pulled for the target platform, so the copied binaries match it.
FROM ${REGISTRY_IMAGE} AS registry-dist
FROM ${TRIVY_IMAGE} AS trivy-dist

# ---- Runtime -----------------------------------------------------------------
FROM alpine:${ALPINE_VERSION} AS runtime

# tini reaps zombies and forwards signals; the agent is its only child.
# ca-certificates is what Trivy needs to download its vulnerability database.
RUN apk add --no-cache ca-certificates tini

COPY --from=registry-dist /bin/registry /usr/local/bin/registry
COPY --from=trivy-dist /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=agent-build /out/registry-agent /usr/local/bin/registry-agent

# registry:3's own configuration, kept for reference.
COPY --from=registry-dist /etc/distribution/config.yml /etc/distribution/config.yml.dist

# The registry's configuration, derived from registry:3's default. Two things
# differ, and both follow from the agent sitting in front of it:
#   - it listens on loopback only (the agent sets REGISTRY_HTTP_ADDR to the
#     same value, so this is belt and braces);
#   - the debug listener is gone. Upstream puts it on :5001, which is exactly
#     where the registry itself listens behind the agent.
# Deletes are enabled here as well as in the child's environment: every
# management operation depends on them.
COPY <<-'EOF' /etc/distribution/config.yml
	version: 0.1
	log:
	  level: info
	  fields:
	    service: registry
	storage:
	  delete:
	    enabled: true
	  cache:
	    blobdescriptor: inmemory
	  filesystem:
	    rootdirectory: /var/lib/registry
	  tag:
	    concurrencylimit: 5
	http:
	  addr: 127.0.0.1:5001
	  headers:
	    X-Content-Type-Options: [nosniff]
	health:
	  storagedriver:
	    enabled: true
	    interval: 10s
	    threshold: 3
EOF

RUN mkdir -p /var/lib/registry /var/lib/registry-agent

# registry:3 exports OpenTelemetry traces to localhost:4318 by default and
# logs an error every few seconds when nothing listens there.
ENV OTEL_TRACES_EXPORTER=none \
    REGISTRY_CONFIG=/etc/distribution/config.yml \
    REGISTRY_STORAGE_ROOT=/var/lib/registry \
    REGISTRY_INTERNAL_ADDR=127.0.0.1:5001 \
    AGENT_DATA_DIR=/var/lib/registry-agent \
    AGENT_LISTEN=:5000 \
    AGENT_API_LISTEN=:5080

# AGENT_API_KEY has no default on purpose: the agent refuses to start without
# one, and a default would be the same on every installation.

EXPOSE 5000 5080
VOLUME ["/var/lib/registry", "/var/lib/registry-agent"]

# The agent answers /healthz as soon as it is up, whatever the registry child
# is doing; GET /api/v1/health tells the whole story and needs the bearer key.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --spider --tries=1 http://127.0.0.1:5080/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/registry-agent"]

# Build definition for Registry Vault's three images.
#
#   vault     kianfar/registry-vault           Dockerfile        (unchanged)
#   registry  kianfar/registry-vault-registry  agent/Dockerfile  (unchanged)
#   aio       kianfar/registry-vault-aio       Dockerfile.aio
#
# The `aio` target does not rebuild the registry side: it takes the runtime
# stage of the `registry` target as a named build context, so agent/Dockerfile
# stays the only place the agent, the registry binary, Trivy and the registry
# configuration are defined. bake builds `registry` first and links it in.
#
#   docker buildx bake -f docker-bake.hcl --load           # all three, this host
#   docker buildx bake -f docker-bake.hcl --load aio       # just the all-in-one
#   docker buildx bake -f docker-bake.hcl \
#     --set '*.platform=linux/amd64,linux/arm64' --push    # a release build
#
# Always pass `-f docker-bake.hcl`. With no -f, bake also reads the
# docker-compose*.yml files in this directory, and those carry `env_file: .env`,
# which is not in the repository — bake then fails before building anything.
#
# TAG defaults to "local" so a bake on a workstation can never be mistaken for
# a release build.

variable "TAG" {
  default = "local"
}

variable "VAULT_IMAGE" {
  default = "kianfar/registry-vault"
}

variable "REGISTRY_AGENT_IMAGE" {
  default = "kianfar/registry-vault-registry"
}

variable "AIO_IMAGE" {
  default = "kianfar/registry-vault-aio"
}

group "default" {
  targets = ["vault", "registry", "aio"]
}

# Registry Vault on its own — the existing image, built exactly as the release
# workflow's own job builds it.
target "vault" {
  context    = "."
  dockerfile = "Dockerfile"
  tags       = ["${VAULT_IMAGE}:${TAG}"]
}

# The registry, its agent and Trivy. Self-contained: context is agent/.
target "registry" {
  context    = "agent"
  dockerfile = "Dockerfile"
  tags       = ["${REGISTRY_AGENT_IMAGE}:${TAG}"]
}

# All of it in one container. `registry-agent` is the name Dockerfile.aio's
# AGENT_BASE build argument defaults to.
target "aio" {
  context    = "."
  dockerfile = "Dockerfile.aio"
  contexts = {
    registry-agent = "target:registry"
  }
  tags = ["${AIO_IMAGE}:${TAG}"]
}

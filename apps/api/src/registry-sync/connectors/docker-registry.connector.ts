import { Injectable, Logger } from '@nestjs/common';

import { normalizeRegistryUrl, resolveRegistryUrl, describeFetchFailure } from './registry-url';

/** Every manifest media type we can resolve: single-arch, OCI, and index/list. */
const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
].join(', ');

export interface DockerDeleteResult {
  ok: boolean;
  reason: string;
}

export interface DockerTagDeleteResult extends DockerDeleteResult {
  /**
   * Tags actually removed from the registry. A manifest delete removes every
   * tag sharing that digest, so this can be wider than the requested tag.
   */
  removedTags: string[];
}

export interface DockerTagBatchDeleteResult {
  /** Every tag the registry no longer has, including siblings of a deleted digest. */
  removedTags: string[];
  /** Requested tags still on the registry, with the reason. */
  failures: { tag: string; reason: string }[];
}

/** Parallel manifest lookups per repository — enough to be fast, few enough not to swamp a small registry. */
const DIGEST_LOOKUP_CONCURRENCY = 8;

export interface DockerDeleteOutcome {
  requested: number;
  deleted: number;
  failures: { tag: string; reason: string }[];
}

export interface DockerPlatformInfo {
  architecture: string;
  os: string;
  variant?: string;
  digest: string;
  sizeBytes: number;
  isAttestation?: boolean;
  /** False when the registry no longer holds this platform's manifest. */
  exists: boolean;
}

export interface DanglingTag {
  tag: string;
  /** Digest the tag resolves to, when the tag manifest itself still exists. */
  digest: string | null;
  /** Human-readable list of references the registry no longer holds. */
  missing: string[];
}

interface WwwAuthenticateParams {
  realm: string;
  service?: string;
  scope?: string;
}

interface DockerTokenResponse {
  token?: string;
  access_token?: string;
}

interface DockerCatalogResponse {
  repositories?: string[];
}

interface DockerTagsResponse {
  tags?: string[];
}

export interface DockerManifestLayer {
  digest: string;
  size: number;
  mediaType?: string;
}

export interface DockerManifestPlatform {
  architecture?: string;
  os?: string;
}

export interface DockerManifestListEntry {
  digest: string;
  mediaType?: string;
  platform?: DockerManifestPlatform;
}

export interface DockerManifest {
  schemaVersion?: number;
  mediaType?: string;
  config?: { digest: string; size: number; mediaType?: string };
  layers?: DockerManifestLayer[];
  /** Present when the response is a manifest list / OCI index */
  manifests?: DockerManifestListEntry[];
  /** Injected from Docker-Content-Digest response header */
  _digest?: string;
}

export interface DockerImageHistoryEntry {
  created?: string;
  created_by?: string;
  empty_layer?: boolean;
}

export interface DockerImageConfig {
  architecture?: string;
  os?: string;
  created?: string;
  history?: DockerImageHistoryEntry[];
  config?: {
    Labels?: Record<string, string>;
    ExposedPorts?: Record<string, unknown>;
    Entrypoint?: string[];
    Cmd?: string[];
    Env?: string[];
  };
}

@Injectable()
export class DockerRegistryConnector {
  private readonly logger = new Logger(DockerRegistryConnector.name);
  private readonly timeoutMs = 10_000;

  /**
   * Docker Registry V2 Auth flow:
   * 1. GET /v2/ -> if 401, read Www-Authenticate header
   * 2. Parse realm, service, scope from Www-Authenticate
   * 3. GET {realm}?service={service}&scope={scope} with Basic auth -> get token
   * 4. Use Bearer token for subsequent requests
   */

  async testConnection(
    url: string,
    username?: string,
    password?: string,
  ): Promise<boolean> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers: Record<string, string> = {};

      if (username && password) {
        headers['Authorization'] = this.basicAuth(username, password);
      }

      const response = await this.fetchWithTimeout(`${baseUrl}/v2/`, {
        method: 'GET',
        headers,
      });

      if (response.status === 200) {
        return true;
      }

      // If 401, try token auth
      if (response.status === 401) {
        const token = await this.getToken(url, username, password);
        if (!token) return false;

        const retryResponse = await this.fetchWithTimeout(`${baseUrl}/v2/`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        return retryResponse.status === 200;
      }

      return false;
    } catch (error: unknown) {
      this.logger.error(`testConnection failed for ${url}: ${(error as Error).message}`);
      return false;
    }
  }

  async getToken(
    url: string,
    username?: string,
    password?: string,
    scope?: string,
  ): Promise<string | null> {
    try {
      const baseUrl = this.normalizeUrl(url);

      // First, make a request to /v2/ to get the Www-Authenticate header
      const headers: Record<string, string> = {};
      if (username && password) {
        headers['Authorization'] = this.basicAuth(username, password);
      }

      const challengeResponse = await this.fetchWithTimeout(
        `${baseUrl}/v2/`,
        { method: 'GET', headers },
      );

      if (challengeResponse.status !== 401) {
        // No auth needed or already authenticated
        return null;
      }

      const wwwAuth = challengeResponse.headers.get('www-authenticate');
      if (!wwwAuth) {
        this.logger.warn('No Www-Authenticate header in 401 response');
        return null;
      }

      const params = this.parseWwwAuthenticate(wwwAuth);
      if (!params) {
        this.logger.warn(`Failed to parse Www-Authenticate: ${wwwAuth}`);
        return null;
      }

      // Build token request URL. The realm is often relative (e.g.
      // `/service/token`) when the registry sits behind a reverse proxy, so
      // resolve it against the registry base URL rather than parsing it alone.
      const tokenUrl = new URL(resolveRegistryUrl(params.realm, baseUrl));
      this.logger.debug(
        `Token auth for ${baseUrl}: realm="${params.realm}" -> ${tokenUrl.origin}${tokenUrl.pathname}`,
      );
      if (params.service) {
        tokenUrl.searchParams.set('service', params.service);
      }
      if (scope) {
        tokenUrl.searchParams.set('scope', scope);
      } else if (params.scope) {
        tokenUrl.searchParams.set('scope', params.scope);
      }

      // Request token with Basic auth if credentials are provided
      const tokenHeaders: Record<string, string> = {};
      if (username && password) {
        tokenHeaders['Authorization'] = this.basicAuth(username, password);
      }

      const tokenResponse = await this.fetchWithTimeout(tokenUrl.toString(), {
        method: 'GET',
        headers: tokenHeaders,
      });

      if (!tokenResponse.ok) {
        this.logger.warn(
          `Token request failed with status ${tokenResponse.status}`,
        );
        return null;
      }

      const body = await tokenResponse.json() as DockerTokenResponse;
      return body.token ?? body.access_token ?? null;
    } catch (error: unknown) {
      this.logger.error(`getToken failed for ${url}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * List every repository in the registry catalog.
   *
   * Throws when the registry cannot be reached or refuses the request. An empty
   * array means the catalog really is empty — callers rely on that distinction
   * to report a sync as failed rather than as "found 0 repositories".
   */
  async listRepositories(
    url: string,
    username?: string,
    password?: string,
  ): Promise<string[]> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const token = await this.getToken(
        url,
        username,
        password,
        'registry:catalog:*',
      );
      const headers = this.authHeaders(token, username, password);

      const allRepositories: string[] = [];
      let nextUrl: string | null = `${baseUrl}/v2/_catalog?n=100`;

      while (nextUrl) {
        const response = await this.fetchWithTimeout(nextUrl, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          throw new Error(
            response.status === 401 || response.status === 403
              ? `Registry rejected the catalog request (HTTP ${response.status}) — check the credentials configured for this connection`
              : `Registry catalog request failed with HTTP ${response.status}`,
          );
        }

        const body = await response.json() as DockerCatalogResponse;
        if (body.repositories && Array.isArray(body.repositories)) {
          allRepositories.push(...body.repositories);
        }

        // Handle pagination via Link header
        nextUrl = this.parseLinkHeader(response.headers.get('link'), baseUrl);
      }

      return allRepositories;
    } catch (error: unknown) {
      this.logger.error(
        `listRepositories failed for ${url}: ${(error as Error).message}`,
      );
      // Rethrow: swallowing this reported a broken sync as "found 0 repositories".
      throw error;
    }
  }

  /**
   * List a repository's tags.
   *
   * An empty array means the registry has no tags for it (including a 404 for
   * a repository that no longer exists). Any other failure throws: treating
   * an unreachable registry as "no tags" made a sync drop live repositories
   * and a delete report nothing to do.
   */
  async listTags(
    url: string,
    repository: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<string[]> {
    const baseUrl = this.normalizeUrl(url);
    const headers = this.resolveAuthHeaders(token, username, password);

    const response = await this.fetchWithTimeout(
      `${baseUrl}/v2/${repository}/tags/list`,
      { method: 'GET', headers },
    );

    if (response.status === 404) {
      await this.discardBody(response);
      return [];
    }

    if (!response.ok) {
      await this.discardBody(response);
      throw new Error(`Listing tags of ${repository} failed with HTTP ${response.status}`);
    }

    const body = await response.json() as DockerTagsResponse;
    return body.tags ?? [];
  }

  /**
   * Resolve a tag to a *platform-specific* manifest, following a manifest list
   * when it finds one. Use this for reading image details.
   *
   * Never use its `_digest` for deletes — for a multi-arch tag it is the child
   * manifest's digest, not the tag's. Use `getTagDigest()` there.
   */
  async getManifest(
    url: string,
    repository: string,
    tag: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<DockerManifest | null> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers: Record<string, string> = {
        // Accept both single-arch and multi-arch (manifest list / OCI index) formats
        Accept: MANIFEST_ACCEPT,
        ...this.resolveAuthHeaders(token, username, password),
      };

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/${repository}/manifests/${tag}`,
        { method: 'GET', headers },
      );

      if (!response.ok) {
        this.logger.warn(
          `getManifest for ${repository}:${tag} failed with status ${response.status}`,
        );
        return null;
      }

      const manifest = await response.json() as DockerManifest;
      const digest = response.headers.get('docker-content-digest');
      if (digest) {
        manifest._digest = digest;
      }

      // If it's a manifest list (multi-arch), resolve to a platform-specific manifest.
      // Prefer linux/amd64; fall back to the first entry.
      if (manifest.manifests && manifest.manifests.length > 0) {
        const preferred = manifest.manifests.find(
          (m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64',
        ) ?? manifest.manifests[0];

        if (preferred?.digest) {
          return this.getManifest(url, repository, preferred.digest, token, username, password);
        }
      }

      return manifest;
    } catch (error: unknown) {
      this.logger.error(
        `getManifest failed for ${repository}:${tag}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async getImageConfig(
    url: string,
    repository: string,
    configDigest: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<DockerImageConfig | null> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers: Record<string, string> = {
        Accept: 'application/vnd.docker.container.image.v1+json',
        ...this.resolveAuthHeaders(token, username, password),
      };

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/${repository}/blobs/${configDigest}`,
        { method: 'GET', headers },
      );

      if (!response.ok) {
        this.logger.warn(
          `getImageConfig for ${repository}@${configDigest} failed with status ${response.status}`,
        );
        return null;
      }

      return await response.json() as DockerImageConfig;
    } catch (error: unknown) {
      this.logger.error(
        `getImageConfig failed for ${repository}@${configDigest}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Resolve the digest the *tag itself* points at.
   *
   * This is deliberately NOT `getManifest()`: that helper follows a manifest
   * list down into the platform-specific child manifest, so its `_digest` is
   * the child's. Deleting a child leaves the tag and its index in place while
   * gutting the image behind them — the registry keeps listing the tag and
   * every pull fails with `manifest unknown`. Deletes must always target the
   * digest the tag resolves to.
   */
  async getTagDigest(
    url: string,
    repository: string,
    tag: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<string | null> {
    const baseUrl = this.normalizeUrl(url);
    const headers: Record<string, string> = {
      Accept: MANIFEST_ACCEPT,
      ...this.resolveAuthHeaders(token, username, password),
    };
    const manifestUrl = `${baseUrl}/v2/${repository}/manifests/${tag}`;

    // HEAD is the cheap path; some proxies drop it, so fall back to GET.
    for (const method of ['HEAD', 'GET'] as const) {
      const response = await this.fetchWithTimeout(manifestUrl, { method, headers });
      await this.discardBody(response);
      if (response.status === 404) return null;
      if (response.ok) {
        const digest = response.headers.get('docker-content-digest');
        if (digest) return digest;
      }
    }

    this.logger.warn(`Could not resolve a content digest for ${repository}:${tag}`);
    return null;
  }

  /**
   * High-level helper: get a scoped delete token then delete every tag of a repo.
   *
   * Only the digests the tags resolve to are deleted. Child manifests are left
   * for the registry's garbage collector on purpose: several tags routinely
   * share the same child (e.g. `latest` and the version tag built from it), so
   * deleting children directly would corrupt tags the caller never selected.
   */
  async deleteRepository(
    url: string,
    repository: string,
    username?: string,
    password?: string,
  ): Promise<DockerDeleteOutcome> {
    const tags = await this.listTags(
      url, repository,
      (await this.getToken(url, username, password, `repository:${repository}:pull,delete`)) ?? undefined,
      username, password,
    );
    const result = await this.deleteTags(url, repository, tags, username, password);

    return {
      requested: tags.length,
      deleted: tags.length - result.failures.length,
      failures: result.failures,
    };
  }

  /**
   * High-level helper: delete a single tag, leaving the rest of the repository
   * intact. See `deleteTags()` for how shared digests are handled.
   */
  async deleteTagByName(
    url: string,
    repository: string,
    tagName: string,
    username?: string,
    password?: string,
    options?: { protectTags?: string[] },
  ): Promise<DockerTagDeleteResult> {
    const result = await this.deleteTags(url, repository, [tagName], username, password, options);
    const failure = result.failures[0];

    return failure
      ? { ok: false, reason: failure.reason, removedTags: [] }
      : { ok: true, reason: 'Deleted', removedTags: result.removedTags };
  }

  /**
   * Delete a set of tags from one repository in a single pass.
   *
   * The Registry V2 API has no "delete this tag" call — a delete always targets
   * a digest, and that removes *every* tag pointing at it. Tags routinely share
   * a digest (`latest` and the version tag built from it), so every tag's
   * digest is resolved once up front, the requested tags are grouped by
   * digest, and each digest is deleted once. Siblings that go with a delete are
   * reported in `removedTags`; callers must reconcile all of them.
   *
   * For a multi-arch tag the digest is the index's, so the whole image goes and
   * its platform manifests are left for garbage collection.
   *
   * Resolving every digest once per repository keeps this linear in the number
   * of tags. Resolving the whole repository again for each deleted tag made a
   * "keep the last N" cleanup of a large repository issue tens of thousands of
   * sequential requests and appear to hang.
   */
  async deleteTags(
    url: string,
    repository: string,
    tagNames: string[],
    username?: string,
    password?: string,
    options?: { protectTags?: string[] },
  ): Promise<DockerTagBatchDeleteResult> {
    const result: DockerTagBatchDeleteResult = { removedTags: [], failures: [] };
    const requested = Array.from(new Set(tagNames));
    if (requested.length === 0) return result;

    const scope = `repository:${repository}:pull,delete`;
    let auth = (await this.getToken(url, username, password, scope)) ?? undefined;

    const allTags = await this.listTags(url, repository, auth, username, password);
    const present = new Set(allTags);

    // Requested tags the registry no longer lists are already gone.
    const removed = new Set(requested.filter((tag) => !present.has(tag)));

    // Resolve every tag once, so a delete can tell which siblings it takes.
    const digests = await this.mapWithConcurrency(allTags, DIGEST_LOOKUP_CONCURRENCY, async (tag) => {
      try {
        return await this.getTagDigest(url, repository, tag, auth, username, password);
      } catch (error: unknown) {
        return error instanceof Error ? error : new Error(String(error));
      }
    });

    const tagsByDigest = new Map<string, string[]>();
    const digestOf = new Map<string, string>();
    const lookupErrors = new Map<string, Error>();
    allTags.forEach((tag, i) => {
      const digest = digests[i];
      if (digest instanceof Error) {
        lookupErrors.set(tag, digest);
        return;
      }
      if (!digest) return;
      digestOf.set(tag, digest);
      tagsByDigest.set(digest, [...(tagsByDigest.get(digest) ?? []), tag]);
    });

    const requestedSet = new Set(requested);
    const protectedTags = new Set((options?.protectTags ?? []).filter((t) => !requestedSet.has(t)));
    const targets = new Map<string, string[]>();

    requested.forEach((tag) => {
      if (removed.has(tag)) return;
      const lookupError = lookupErrors.get(tag);
      if (lookupError) {
        result.failures.push({ tag, reason: lookupError.message });
        return;
      }
      const digest = digestOf.get(tag);
      if (!digest) {
        // Listed but no longer resolvable — nothing left to delete.
        removed.add(tag);
        return;
      }
      targets.set(digest, [...(targets.get(digest) ?? []), tag]);
    });

    // Tokens can be short-lived; take a fresh one for the delete phase.
    if (targets.size > 0 && auth) {
      auth = (await this.getToken(url, username, password, scope)) ?? auth;
    }

    for (const [digest, tags] of targets) {
      const siblings = tagsByDigest.get(digest) ?? tags;

      // Refuse when the delete would also take a tag the caller wants kept —
      // e.g. retention deleting an old version tag that `latest` also points at.
      const protectedHits = siblings.filter((tag) => protectedTags.has(tag));
      if (protectedHits.length > 0) {
        const reason = `Skipped: shares its manifest with ${protectedHits.join(', ')}, which would be deleted too`;
        tags.forEach((tag) => result.failures.push({ tag, reason }));
        continue;
      }

      const deleted = await this.deleteManifest(url, repository, digest, auth, username, password);
      if (deleted.ok) {
        siblings.forEach((tag) => removed.add(tag));
      } else {
        tags.forEach((tag) => result.failures.push({ tag, reason: deleted.reason }));
      }
    }

    result.removedTags = Array.from(removed);
    return result;
  }

  /** Run `fn` over `items` with at most `limit` calls in flight, keeping order. */
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  /**
   * Resolve every platform published under a tag.
   *
   * A multi-arch tag points at an index listing one manifest per platform (plus
   * buildx attestation entries, which are flagged rather than dropped). A
   * single-platform tag reports one entry, so callers can treat both alike.
   */
  async getTagPlatforms(
    url: string,
    repository: string,
    tag: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<DockerPlatformInfo[]> {
    const manifest = await this.getRawManifest(url, repository, tag, token, username, password);
    if (!manifest) return [];

    // Single-platform tag: the config blob carries the platform.
    if (!manifest.manifests || manifest.manifests.length === 0) {
      const size = (manifest.layers ?? []).reduce((sum, l) => sum + (l.size ?? 0), 0);
      let architecture = 'unknown';
      let os = 'unknown';

      if (manifest.config?.digest) {
        const config = await this.getImageConfig(
          url, repository, manifest.config.digest, token, username, password,
        );
        architecture = config?.architecture ?? architecture;
        os = config?.os ?? os;
      }

      return [{
        architecture,
        os,
        digest: manifest._digest ?? '',
        sizeBytes: size,
        exists: true,
      }];
    }

    const platforms: DockerPlatformInfo[] = [];

    for (const entry of manifest.manifests) {
      // buildx records provenance/SBOM as index entries with an unknown
      // platform; they are not runnable images.
      const isAttestation =
        entry.platform?.os === 'unknown' ||
        entry.platform?.architecture === 'unknown' ||
        Boolean((entry as { annotations?: Record<string, string> }).annotations?.['vnd.docker.reference.type']);

      // Attestations are never shown or sized, so skip the extra round trip
      // and trust the index entry — a tag with many platforms would otherwise
      // double its manifest fetches for data nothing reads.
      const child = isAttestation
        ? null
        : await this.getRawManifest(url, repository, entry.digest, token, username, password);

      const sizeBytes = child
        ? (child.layers ?? []).reduce((sum, l) => sum + (l.size ?? 0), 0)
        : 0;

      platforms.push({
        architecture: entry.platform?.architecture ?? 'unknown',
        os: entry.platform?.os ?? 'unknown',
        variant: (entry.platform as { variant?: string } | undefined)?.variant,
        digest: entry.digest,
        sizeBytes,
        isAttestation,
        // A missing child is the fingerprint of a partial delete; an
        // unfetched attestation is not evidence either way.
        exists: isAttestation || child !== null,
      });
    }

    return platforms;
  }

  /**
   * Report tags whose manifest is missing or references content the registry no
   * longer has, i.e. tags left dangling by a partial delete.
   */
  async findDanglingTags(
    url: string,
    repository: string,
    username?: string,
    password?: string,
  ): Promise<DanglingTag[]> {
    const token = await this.getToken(url, username, password, `repository:${repository}:pull,delete`);
    const auth = token ?? undefined;
    const tags = await this.listTags(url, repository, auth, username, password);
    const dangling: DanglingTag[] = [];

    for (const tag of tags) {
      const digest = await this.getTagDigest(url, repository, tag, auth, username, password);

      if (!digest) {
        dangling.push({ tag, digest: null, missing: ['tag manifest'] });
        continue;
      }

      const platforms = await this.getTagPlatforms(url, repository, tag, auth, username, password);
      const missing = platforms
        .filter((p) => !p.exists)
        .map((p) => `${p.os}/${p.architecture} manifest ${p.digest}`);

      if (missing.length > 0) {
        dangling.push({ tag, digest, missing });
      }
    }

    return dangling;
  }

  /**
   * Fetch a manifest exactly as the reference resolves it, without following a
   * manifest list into a platform-specific child.
   */
  async getRawManifest(
    url: string,
    repository: string,
    reference: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<DockerManifest | null> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers: Record<string, string> = {
        Accept: MANIFEST_ACCEPT,
        ...this.resolveAuthHeaders(token, username, password),
      };

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/${repository}/manifests/${reference}`,
        { method: 'GET', headers },
      );

      if (!response.ok) return null;

      const manifest = await response.json() as DockerManifest;
      const digest = response.headers.get('docker-content-digest');
      if (digest) {
        manifest._digest = digest;
      }
      return manifest;
    } catch (error: unknown) {
      this.logger.error(
        `getRawManifest failed for ${repository}:${reference}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async deleteManifest(
    url: string,
    repository: string,
    digest: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<DockerDeleteResult> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const deleteHeaders = this.resolveAuthHeaders(token, username, password);

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/${repository}/manifests/${digest}`,
        { method: 'DELETE', headers: deleteHeaders },
      );
      await this.discardBody(response);

      if (response.status === 202 || response.status === 200) {
        return { ok: true, reason: 'Deleted' };
      }

      // Already absent — the caller's goal is met either way.
      if (response.status === 404) {
        return { ok: true, reason: 'Already absent on the registry' };
      }

      const reason = this.describeDeleteFailure(response.status);
      this.logger.warn(`deleteManifest for ${repository}@${digest}: ${reason}`);
      return { ok: false, reason };
    } catch (error: unknown) {
      const reason = (error as Error).message;
      this.logger.error(`deleteManifest failed for ${repository}@${digest}: ${reason}`);
      return { ok: false, reason };
    }
  }

  private describeDeleteFailure(status: number): string {
    if (status === 405) {
      return 'Registry refused the delete (HTTP 405) — deletion is disabled on this registry; set REGISTRY_STORAGE_DELETE_ENABLED=true';
    }
    if (status === 401 || status === 403) {
      return `Registry rejected the delete (HTTP ${status}) — the configured credentials lack delete permission on this repository`;
    }
    return `Registry delete failed with HTTP ${status}`;
  }

  // ---- Private helpers ----

  private normalizeUrl(url: string): string {
    return normalizeRegistryUrl(url);
  }

  private basicAuth(username: string, password: string): string {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${encoded}`;
  }

  private authHeaders(
    token?: string | null,
    username?: string,
    password?: string,
  ): Record<string, string> {
    return this.resolveAuthHeaders(token ?? undefined, username, password);
  }

  private resolveAuthHeaders(
    token?: string,
    username?: string,
    password?: string,
  ): Record<string, string> {
    if (token) return { Authorization: `Bearer ${token}` };
    if (username && password) return { Authorization: this.basicAuth(username, password) };
    return {};
  }

  private parseWwwAuthenticate(header: string): WwwAuthenticateParams | null {
    // Parse: Bearer realm="...",service="...",scope="..."
    const realmMatch = header.match(/realm="([^"]+)"/);
    if (!realmMatch) return null;

    const serviceMatch = header.match(/service="([^"]+)"/);
    const scopeMatch = header.match(/scope="([^"]+)"/);

    return {
      realm: realmMatch[1],
      service: serviceMatch?.[1],
      scope: scopeMatch?.[1],
    };
  }

  private parseLinkHeader(linkHeader: string | null, baseUrl: string): string | null {
    if (!linkHeader) return null;

    // Parse: <url>; rel="next"
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    if (!match) return null;

    // Registries return this as a path (`/v2/_catalog?n=100&last=foo`), which
    // fetch() cannot use on its own.
    try {
      return resolveRegistryUrl(match[1], baseUrl);
    } catch {
      this.logger.warn(`Ignoring unusable pagination Link header: ${linkHeader}`);
      return null;
    }
  }

  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      // The signal stays armed after the headers arrive, so reading the body
      // is bounded too. Clearing the timer on headers let a registry that
      // stalls mid-body (e.g. a full disk) hang a sync or delete forever.
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      // Replace Node's opaque "fetch failed" with the underlying cause.
      throw new Error(describeFetchFailure(url, error, this.timeoutMs));
    }
  }

  /** Release a response body nothing reads, so its connection is reused. */
  private async discardBody(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
  }
}

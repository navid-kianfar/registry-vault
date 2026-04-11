import { Injectable, Logger } from '@nestjs/common';

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

      // Build token request URL
      const tokenUrl = new URL(params.realm);
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
          this.logger.warn(
            `listRepositories failed with status ${response.status}`,
          );
          break;
        }

        const body = await response.json() as DockerCatalogResponse;
        if (body.repositories && Array.isArray(body.repositories)) {
          allRepositories.push(...body.repositories);
        }

        // Handle pagination via Link header
        nextUrl = this.parseLinkHeader(response.headers.get('link'));
      }

      return allRepositories;
    } catch (error: unknown) {
      this.logger.error(
        `listRepositories failed for ${url}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  async listTags(
    url: string,
    repository: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<string[]> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.resolveAuthHeaders(token, username, password);

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/${repository}/tags/list`,
        { method: 'GET', headers },
      );

      if (!response.ok) {
        this.logger.warn(
          `listTags for ${repository} failed with status ${response.status}`,
        );
        return [];
      }

      const body = await response.json() as DockerTagsResponse;
      return body.tags ?? [];
    } catch (error: unknown) {
      this.logger.error(
        `listTags failed for ${repository}: ${(error as Error).message}`,
      );
      return [];
    }
  }

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
        Accept: [
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.oci.image.index.v1+json',
        ].join(', '),
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
   * High-level helper: get a scoped delete token then delete all tags for a repo.
   * Returns the number of tags successfully deleted on the registry.
   */
  async deleteRepository(
    url: string,
    repository: string,
    username?: string,
    password?: string,
  ): Promise<number> {
    const token = await this.getToken(url, username, password, `repository:${repository}:pull,delete`);

    const tags = await this.listTags(url, repository, token ?? undefined, username, password);
    let deleted = 0;

    for (const tag of tags) {
      const manifest = await this.getManifest(url, repository, tag, token ?? undefined, username, password);
      const digest = manifest?._digest ?? manifest?.config?.digest;
      if (digest) {
        const ok = await this.deleteManifest(url, repository, digest, token ?? undefined, username, password);
        if (ok) deleted++;
      }
    }

    return deleted;
  }

  /**
   * High-level helper: delete a single tag by name.
   */
  async deleteTagByName(
    url: string,
    repository: string,
    tagName: string,
    username?: string,
    password?: string,
  ): Promise<boolean> {
    const token = await this.getToken(url, username, password, `repository:${repository}:pull,delete`);
    const manifest = await this.getManifest(url, repository, tagName, token ?? undefined, username, password);
    const digest = manifest?._digest ?? manifest?.config?.digest;
    if (!digest) return false;
    return this.deleteManifest(url, repository, digest, token ?? undefined, username, password);
  }

  async deleteManifest(
    url: string,
    repository: string,
    digest: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<boolean> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const deleteHeaders = this.resolveAuthHeaders(token, username, password);

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/${repository}/manifests/${digest}`,
        { method: 'DELETE', headers: deleteHeaders },
      );

      if (response.status === 202 || response.status === 200) {
        return true;
      }

      this.logger.warn(
        `deleteManifest for ${repository}@${digest} returned status ${response.status}`,
      );
      return false;
    } catch (error: unknown) {
      this.logger.error(
        `deleteManifest failed for ${repository}@${digest}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // ---- Private helpers ----

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
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

  private parseLinkHeader(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    // Parse: <url>; rel="next"
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match?.[1] ?? null;
  }

  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

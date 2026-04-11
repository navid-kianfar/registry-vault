import { Injectable, Logger } from '@nestjs/common';

export interface NpmSearchResult {
  package?: {
    name?: string;
    version?: string;
    description?: string;
    author?: { name?: string };
    keywords?: string[];
    links?: { homepage?: string };
    license?: string;
  };
}

interface NpmSearchResponse {
  objects?: NpmSearchResult[];
}

export interface NpmVersionMetadata {
  dist?: {
    size?: number;
    unpackedSize?: number;
    shasum?: string;
    integrity?: string;
  };
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface NpmPackageMetadata {
  name?: string;
  description?: string;
  license?: string;
  keywords?: string[];
  repository?: string | { url?: string };
  homepage?: string;
  readme?: string;
  author?: string | { name?: string };
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, NpmVersionMetadata>;
  time?: Record<string, string>;
}

@Injectable()
export class NpmRegistryConnector {
  private readonly logger = new Logger(NpmRegistryConnector.name);
  private readonly timeoutMs = 10_000;

  /**
   * Test connectivity to an NPM-compatible registry.
   * Tries GET {url}/-/ping first, then falls back to GET {url}/.
   */
  async testConnection(
    url: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<boolean> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(token, username, password);

      // Try /-/ping first (Verdaccio, npm registry)
      const pingResponse = await this.fetchWithTimeout(
        `${baseUrl}/-/ping`,
        { method: 'GET', headers },
      );

      if (pingResponse.ok) {
        return true;
      }

      // Fall back to root endpoint
      const rootResponse = await this.fetchWithTimeout(baseUrl, {
        method: 'GET',
        headers,
      });

      return rootResponse.ok;
    } catch (error: unknown) {
      this.logger.error(`testConnection failed for ${url}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Search for packages in the NPM registry.
   * Uses the /-/v1/search endpoint.
   */
  async searchPackages(
    url: string,
    token?: string,
    text?: string,
    username?: string,
    password?: string,
  ): Promise<NpmSearchResult[]> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(token, username, password);

      const searchUrl = new URL(`${baseUrl}/-/v1/search`);
      if (text) {
        searchUrl.searchParams.set('text', text);
      }
      searchUrl.searchParams.set('size', '250');

      const response = await this.fetchWithTimeout(searchUrl.toString(), {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        this.logger.warn(
          `searchPackages failed with status ${response.status}`,
        );
        return [];
      }

      const body = await response.json() as NpmSearchResponse;
      return body.objects ?? [];
    } catch (error: unknown) {
      this.logger.error(`searchPackages failed for ${url}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Get full package metadata including all versions, dist-tags, readme, etc.
   */
  async getPackageMetadata(
    url: string,
    packageName: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<NpmPackageMetadata | null> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(token, username, password);
      // Accept abbreviated metadata or full
      headers['Accept'] =
        'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';

      // Scoped packages: @scope/name needs to be URL-encoded
      const encodedName = encodeURIComponent(packageName).replace('%40', '@');
      const response = await this.fetchWithTimeout(
        `${baseUrl}/${encodedName}`,
        { method: 'GET', headers },
      );

      if (!response.ok) {
        this.logger.warn(
          `getPackageMetadata for ${packageName} failed with status ${response.status}`,
        );
        return null;
      }

      return await response.json() as NpmPackageMetadata;
    } catch (error: unknown) {
      this.logger.error(
        `getPackageMetadata failed for ${packageName}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Unpublish an entire package from the registry.
   * Uses DELETE /{packageName} — supported by Verdaccio, Nexus, JFrog, etc.
   */
  async unpublishPackage(
    url: string,
    packageName: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<boolean> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(token, username, password);
      const encodedName = encodeURIComponent(packageName).replace('%40', '@');

      const response = await this.fetchWithTimeout(
        `${baseUrl}/${encodedName}`,
        { method: 'DELETE', headers },
      );

      if (response.ok || response.status === 404) {
        return true;
      }

      this.logger.warn(`unpublishPackage ${packageName} returned status ${response.status}`);
      return false;
    } catch (error: unknown) {
      this.logger.error(`unpublishPackage failed for ${packageName}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Unpublish a specific version from the registry.
   * Uses DELETE /{packageName}/{version} — supported by Verdaccio and most private registries.
   */
  async unpublishVersion(
    url: string,
    packageName: string,
    version: string,
    token?: string,
    username?: string,
    password?: string,
  ): Promise<boolean> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(token, username, password);
      const encodedName = encodeURIComponent(packageName).replace('%40', '@');

      const response = await this.fetchWithTimeout(
        `${baseUrl}/${encodedName}/${version}`,
        { method: 'DELETE', headers },
      );

      if (response.ok || response.status === 404) {
        return true;
      }

      this.logger.warn(`unpublishVersion ${packageName}@${version} returned status ${response.status}`);
      return false;
    } catch (error: unknown) {
      this.logger.error(`unpublishVersion failed for ${packageName}@${version}: ${(error as Error).message}`);
      return false;
    }
  }

  // ---- Private helpers ----

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private buildHeaders(
    token?: string,
    username?: string,
    password?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (username && password) {
      const encoded = Buffer.from(`${username}:${password}`).toString(
        'base64',
      );
      headers['Authorization'] = `Basic ${encoded}`;
    }

    return headers;
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

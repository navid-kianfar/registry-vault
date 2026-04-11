import { Injectable, Logger } from '@nestjs/common';

interface NuGetServiceResource {
  '@id': string;
  '@type': string;
  comment?: string;
}

interface NuGetServiceIndex {
  resources?: NuGetServiceResource[];
}

interface NuGetSearchResponse {
  data?: NuGetSearchResult[];
}

export interface NuGetDependency {
  id?: string;
  range?: string;
  version?: string;
}

export interface NuGetDependencyGroup {
  targetFramework?: string;
  dependencies?: NuGetDependency[];
}

export interface NuGetCatalogEntry {
  version?: string;
  downloads?: number;
  published?: string;
  listed?: boolean;
  dependencyGroups?: NuGetDependencyGroup[];
  packageSize?: number;
  packageHash?: string;
  packageHashAlgorithm?: string;
}

export interface NuGetRegistrationEntry {
  catalogEntry?: NuGetCatalogEntry;
  version?: string;
  downloads?: number;
  published?: string;
  listed?: boolean;
  dependencyGroups?: NuGetDependencyGroup[];
  packageSize?: number;
  packageHash?: string;
  packageHashAlgorithm?: string;
}

export interface NuGetRegistrationPage {
  items?: NuGetRegistrationEntry[];
}

export interface NuGetPackageVersionData {
  items?: NuGetRegistrationPage[];
}

export interface NuGetSearchResult {
  id?: string;
  packageId?: string;
  version?: string;
  title?: string;
  authors?: string | string[];
  description?: string;
  totalDownloads?: number;
  tags?: string[];
  projectUrl?: string;
  licenseExpression?: string;
  iconUrl?: string;
  versions?: Array<{ version: string }>;
}

@Injectable()
export class NuGetRegistryConnector {
  private readonly logger = new Logger(NuGetRegistryConnector.name);
  private readonly timeoutMs = 10_000;

  /**
   * Test connectivity to a NuGet V3 compatible registry.
   * Verifies the service index is accessible at {url}/v3/index.json.
   */
  async testConnection(url: string, apiKey?: string, password?: string, apiKeyHeader?: string): Promise<boolean> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(apiKey, password, apiKeyHeader);

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v3/index.json`,
        { method: 'GET', headers },
      );

      return response.ok;
    } catch (error: unknown) {
      this.logger.error(`testConnection failed for ${url}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Get the NuGet V3 service index.
   * Returns the resources array with @type and @id for each service.
   */
  async getServiceIndex(
    url: string,
    apiKey?: string,
    password?: string,
    apiKeyHeader?: string,
  ): Promise<NuGetServiceResource[]> {
    try {
      const baseUrl = this.normalizeUrl(url);
      const headers = this.buildHeaders(apiKey, password, apiKeyHeader);

      const response = await this.fetchWithTimeout(
        `${baseUrl}/v3/index.json`,
        { method: 'GET', headers },
      );

      if (!response.ok) {
        this.logger.warn(
          `getServiceIndex failed with status ${response.status}`,
        );
        return [];
      }

      const body = await response.json() as NuGetServiceIndex;
      return body.resources ?? [];
    } catch (error: unknown) {
      this.logger.error(
        `getServiceIndex failed for ${url}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Search packages using the SearchQueryService from the service index.
   */
  async searchPackages(
    url: string,
    apiKey?: string,
    query?: string,
    password?: string,
    apiKeyHeader?: string,
  ): Promise<NuGetSearchResult[]> {
    try {
      const resources = await this.getServiceIndex(url, apiKey, password, apiKeyHeader);
      const searchResource = this.findResource(resources, 'SearchQueryService');

      if (!searchResource) {
        this.logger.warn('SearchQueryService not found in service index');
        return [];
      }

      const headers = this.buildHeaders(apiKey, password, apiKeyHeader);
      const searchUrl = new URL(searchResource['@id']);
      if (query) {
        searchUrl.searchParams.set('q', query);
      }
      searchUrl.searchParams.set('take', '100');
      searchUrl.searchParams.set('prerelease', 'true');

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

      const body = await response.json() as NuGetSearchResponse;
      return body.data ?? [];
    } catch (error: unknown) {
      this.logger.error(`searchPackages failed for ${url}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Get package versions using the RegistrationsBaseUrl from the service index.
   */
  async getPackageVersions(
    url: string,
    packageId: string,
    apiKey?: string,
    password?: string,
    apiKeyHeader?: string,
  ): Promise<NuGetPackageVersionData | null> {
    try {
      const resources = await this.getServiceIndex(url, apiKey, password, apiKeyHeader);
      const registrationResource = this.findResource(
        resources,
        'RegistrationsBaseUrl',
      );

      if (!registrationResource) {
        this.logger.warn('RegistrationsBaseUrl not found in service index');
        return null;
      }

      const headers = this.buildHeaders(apiKey, password, apiKeyHeader);
      const registrationBaseUrl = registrationResource['@id'].replace(
        /\/+$/,
        '',
      );
      const lowerId = packageId.toLowerCase();

      const response = await this.fetchWithTimeout(
        `${registrationBaseUrl}/${lowerId}/index.json`,
        { method: 'GET', headers },
      );

      if (!response.ok) {
        this.logger.warn(
          `getPackageVersions for ${packageId} failed with status ${response.status}`,
        );
        return null;
      }

      return await response.json() as NuGetPackageVersionData;
    } catch (error: unknown) {
      this.logger.error(
        `getPackageVersions failed for ${packageId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Delete a specific package version from the registry.
   * Uses the PackagePublish/2.0.0 resource from the service index:
   *   DELETE {base}/{packageId}/{version}
   */
  async deletePackageVersion(
    url: string,
    packageId: string,
    version: string,
    apiKey?: string,
    password?: string,
    apiKeyHeader?: string,
  ): Promise<boolean> {
    try {
      const resources = await this.getServiceIndex(url, apiKey, password, apiKeyHeader);
      const publishResource = this.findResource(resources, 'PackagePublish');

      if (!publishResource) {
        this.logger.warn('PackagePublish resource not found in service index');
        return false;
      }

      const headers = this.buildHeaders(apiKey, password, apiKeyHeader);
      const base = publishResource['@id'].replace(/\/+$/, '');
      const response = await this.fetchWithTimeout(
        `${base}/${packageId}/${version}`,
        { method: 'DELETE', headers },
      );

      if (response.ok || response.status === 404) {
        return true;
      }

      this.logger.warn(`deletePackageVersion ${packageId}@${version} returned status ${response.status}`);
      return false;
    } catch (error: unknown) {
      this.logger.error(`deletePackageVersion failed for ${packageId}@${version}: ${(error as Error).message}`);
      return false;
    }
  }

  // ---- Private helpers ----

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private buildHeaders(apiKey?: string, password?: string, apiKeyHeader?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (apiKey && password) {
      // BasicAuth: apiKey is username
      headers['Authorization'] = `Basic ${Buffer.from(`${apiKey}:${password}`).toString('base64')}`;
    } else if (apiKey) {
      if (apiKeyHeader === 'Authorization') {
        // Bearer token
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        // API key header (default: X-NuGet-ApiKey)
        headers[apiKeyHeader || 'X-NuGet-ApiKey'] = apiKey;
      }
    }
    return headers;
  }

  /**
   * Find a resource by type in the NuGet service index.
   * Handles versioned types like "SearchQueryService/3.0.0-beta".
   */
  private findResource(
    resources: NuGetServiceResource[],
    typePrefix: string,
  ): NuGetServiceResource | undefined {
    return resources.find((r) => r['@type'].startsWith(typePrefix));
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

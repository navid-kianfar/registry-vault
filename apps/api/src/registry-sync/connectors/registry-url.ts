/**
 * URL and network-error handling shared by the registry connectors.
 *
 * `fetch()` requires an absolute URL. Registry endpoints are entered by hand in
 * the Settings UI, and registries themselves hand back relative URLs (token
 * realms, pagination Link headers), so both need normalizing before use.
 */

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turn a user-entered registry endpoint into an absolute base URL with no
 * trailing slash.
 *
 * A value such as `registry.example.com` has no scheme, and passing it to
 * `fetch()` fails with "Failed to parse URL". Default to https, matching the
 * Docker CLI's treatment of a bare registry host — enter `http://` explicitly
 * for a registry served over plain HTTP.
 *
 * @throws if the value cannot be parsed as a URL, so callers log something
 * actionable instead of a parse error from deep inside fetch().
 */
export function normalizeRegistryUrl(url: string): string {
  const trimmed = url?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) {
    throw new Error('Registry URL is empty');
  }

  const absolute = SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    throw new Error(`Invalid registry URL: "${url}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Unsupported registry URL scheme "${parsed.protocol}" in "${url}" — use http or https`,
    );
  }

  return absolute;
}

/**
 * Resolve a URL a registry gave us against the registry's own base URL.
 *
 * Registries commonly return relative values: a token realm of `/service/token`
 * (typical behind a reverse proxy) or a pagination Link header of
 * `</v2/_catalog?n=100&last=foo>; rel="next"`. Absolute values pass through
 * unchanged, so this is safe to apply to both.
 *
 * @throws if the result is not a usable URL.
 */
export function resolveRegistryUrl(candidate: string, baseUrl: string): string {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    throw new Error(`Cannot resolve "${candidate}" against registry URL "${baseUrl}"`);
  }
}

/**
 * Turn a failed `fetch()` into a message that names the actual cause.
 *
 * Node reports every network failure as the opaque string "fetch failed" and
 * puts the real reason (ENOTFOUND, ECONNREFUSED, certificate errors, …) on
 * `error.cause`. Surfacing that is the difference between a log line an
 * operator can act on and one they cannot.
 */
export function describeFetchFailure(
  url: string,
  error: unknown,
  timeoutMs: number,
): string {
  const err = error as
    | { name?: string; message?: string; cause?: { code?: string; message?: string } }
    | undefined;

  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return `Request to ${url} timed out after ${timeoutMs}ms`;
  }

  const cause = err?.cause;
  const detail = cause?.code ?? cause?.message ?? err?.message;

  return detail
    ? `Request to ${url} failed: ${detail}`
    : `Request to ${url} failed`;
}

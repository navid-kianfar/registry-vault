#!/usr/bin/env node
/**
 * Repair a Docker registry left half-deleted by a partial manifest delete.
 *
 * A delete that targeted a platform child manifest instead of the tag's own
 * manifest leaves the tag and its index in place while the image underneath is
 * gone: the repository keeps listing the tag and every pull fails with
 * `manifest unknown`. This scans for that state and, with --apply, deletes the
 * tag manifests so the tags really disappear.
 *
 * Usage:
 *   node scripts/registry-repair.mjs --url https://registry.example.com \
 *     --username USER --password PASS [--repo PREFIX] [--apply]
 *
 * Credentials may also come from REGISTRY_USERNAME / REGISTRY_PASSWORD.
 * Without --apply nothing is deleted — it only reports.
 */

const MANIFEST_ACCEPT = [
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.index.v1+json',
].join(', ');

// ── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const args = { apply: false, repo: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--apply') args.apply = true;
        else if (arg === '--url') args.url = argv[++i];
        else if (arg === '--username') args.username = argv[++i];
        else if (arg === '--password') args.password = argv[++i];
        else if (arg === '--repo') args.repo.push(argv[++i]);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    args.username ??= process.env.REGISTRY_USERNAME;
    args.password ??= process.env.REGISTRY_PASSWORD;
    if (!args.url) throw new Error('--url is required');
    return args;
}

// ── registry client ──────────────────────────────────────────────────────────

function createClient({ url, username, password }) {
    const baseUrl = url.replace(/\/+$/, '');
    const headers = {};
    if (username && password) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    async function request(path, { method = 'GET', accept = MANIFEST_ACCEPT } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { ...headers, Accept: accept },
        });
        return response;
    }

    return {
        async listRepositories() {
            const repositories = [];
            let path = '/v2/_catalog?n=100';
            while (path) {
                const response = await request(path, { accept: 'application/json' });
                if (!response.ok) {
                    throw new Error(`Catalog request failed with HTTP ${response.status}`);
                }
                const body = await response.json();
                repositories.push(...(body.repositories ?? []));
                const link = response.headers.get('link');
                const next = link?.match(/<([^>]+)>;\s*rel="next"/);
                path = next ? next[1] : null;
            }
            return repositories;
        },

        async listTags(repository) {
            const response = await request(`/v2/${repository}/tags/list`, { accept: 'application/json' });
            if (!response.ok) return [];
            const body = await response.json();
            return body.tags ?? [];
        },

        /** The digest the reference resolves to — never a child's. */
        async getDigest(repository, reference) {
            const response = await request(`/v2/${repository}/manifests/${reference}`, { method: 'HEAD' });
            if (!response.ok) return null;
            return response.headers.get('docker-content-digest');
        },

        async getManifest(repository, reference) {
            const response = await request(`/v2/${repository}/manifests/${reference}`);
            if (!response.ok) return null;
            return response.json();
        },

        async deleteManifest(repository, digest) {
            const response = await request(`/v2/${repository}/manifests/${digest}`, { method: 'DELETE' });
            if (response.status === 200 || response.status === 202 || response.status === 404) {
                return { ok: true };
            }
            if (response.status === 405) {
                return { ok: false, reason: 'deletion disabled on this registry (REGISTRY_STORAGE_DELETE_ENABLED)' };
            }
            return { ok: false, reason: `HTTP ${response.status}` };
        },
    };
}

// ── scan ─────────────────────────────────────────────────────────────────────

/** Tags whose manifest is missing, or that reference content the registry lost. */
async function findDanglingTags(client, repository) {
    const dangling = [];

    for (const tag of await client.listTags(repository)) {
        const digest = await client.getDigest(repository, tag);
        if (!digest) {
            dangling.push({ tag, digest: null, missing: ['tag manifest'] });
            continue;
        }

        const manifest = await client.getManifest(repository, tag);
        const missing = [];

        for (const child of manifest?.manifests ?? []) {
            if (!(await client.getDigest(repository, child.digest))) {
                const platform = child.platform
                    ? `${child.platform.os ?? '?'}/${child.platform.architecture ?? '?'}`
                    : 'unknown';
                missing.push(`${platform} ${child.digest.slice(0, 19)}…`);
            }
        }

        if (missing.length > 0) dangling.push({ tag, digest, missing });
    }

    return dangling;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const client = createClient(args);

    const all = await client.listRepositories();
    const repositories = args.repo.length
        ? all.filter((name) => args.repo.some((prefix) => name.startsWith(prefix)))
        : all;

    console.log(`Scanning ${repositories.length} of ${all.length} repositories on ${args.url}`);
    console.log(args.apply ? 'Mode: APPLY — dangling tags will be deleted\n' : 'Mode: dry run — nothing will be deleted\n');

    let totalDangling = 0;
    let totalRepaired = 0;
    const failures = [];

    for (const repository of repositories) {
        const dangling = await findDanglingTags(client, repository);
        if (dangling.length === 0) continue;

        totalDangling += dangling.length;
        console.log(`${repository}: ${dangling.length} dangling tag(s)`);

        for (const entry of dangling) {
            console.log(`  ${entry.tag} — missing ${entry.missing.join(', ')}`);

            if (!args.apply || !entry.digest) continue;

            // Deleting the digest removes every tag pointing at it, so a tag
            // already taken by a sibling reports as absent (404 → ok).
            const result = await client.deleteManifest(repository, entry.digest);
            if (result.ok) {
                totalRepaired++;
                console.log('    deleted');
            } else {
                failures.push({ repository, tag: entry.tag, reason: result.reason });
                console.log(`    FAILED — ${result.reason}`);
            }
        }
    }

    console.log('');
    console.log(`Dangling tags found: ${totalDangling}`);
    if (args.apply) {
        console.log(`Tag manifests deleted: ${totalRepaired}`);
        console.log(`Failures: ${failures.length}`);
        for (const failure of failures) {
            console.log(`  ${failure.repository}:${failure.tag} — ${failure.reason}`);
        }
        if (totalRepaired > 0) {
            console.log('');
            console.log('Blobs stay on disk until the registry garbage-collects. On the registry host:');
            console.log('  registry garbage-collect --delete-untagged=true /etc/docker/registry/config.yml');
        }
    } else if (totalDangling > 0) {
        console.log('Re-run with --apply to delete these tag manifests.');
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * Release script for Terminuks
 *
 * Usage:
 *   node scripts/release.mjs            # bumps patch  (1.0.1 → 1.0.2)
 *   node scripts/release.mjs patch      # bumps patch
 *   node scripts/release.mjs minor      # bumps minor  (1.0.1 → 1.1.0)
 *   node scripts/release.mjs major      # bumps major  (1.0.1 → 2.0.0)
 *   node scripts/release.mjs 1.2.3      # sets an exact version
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd) {
    console.log(`  → ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
}

function bumpVersion(current, type) {
    const [major, minor, patch] = current.split('.').map(Number);
    switch (type) {
        case 'major': return `${major + 1}.0.0`;
        case 'minor': return `${major}.${minor + 1}.0`;
        case 'patch': return `${major}.${minor}.${patch + 1}`;
        default: throw new Error(`Unknown bump type: ${type}`);
    }
}

function isExplicitVersion(str) {
    return /^\d+\.\d+\.\d+$/.test(str);
}

// ── main ─────────────────────────────────────────────────────────────────────

const arg = process.argv[2] ?? 'patch';

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

const next = isExplicitVersion(arg) ? arg : bumpVersion(current, arg);

if (next === current) {
    console.error(`✗ New version (${next}) is the same as current (${current}). Aborting.`);
    process.exit(1);
}

const tag = `v${next}`;

console.log(`\nReleasing ${current} → ${next}  (tag: ${tag})\n`);

// 1. Patch package.json
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`✓ Updated package.json to ${next}`);

// 2. Git operations
try {
    run(`git add package.json`);
    run(`git commit -m "Release ${tag}"`);
    run(`git tag ${tag}`);
    run(`git push origin main`);
    run(`git push origin ${tag}`);
} catch (err) {
    console.error('\n✗ Git operation failed. package.json has been updated but git state may be partial.');
    process.exit(1);
}

console.log(`\n✅ Released ${tag} successfully!`);

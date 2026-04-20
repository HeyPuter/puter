#!/usr/bin/env node
/*
 * Migrate v1 prod per-server overrides into a v2 servers.json.
 *
 * Usage:
 *   node tools/migrateServers.mjs [--input <path>] [--output <path>]
 *
 * Defaults:
 *   --input  /volatile/config/config.json
 *   --output <repo>/packages/puter/servers.json
 *
 * Input file must contain a `{ servers: [...] }` doc (either on its own or
 * concatenated with the base; the base is ignored — only per-server kernel
 * overrides are transformed).
 *
 * Output: an array of per-server *deltas* in v2 shape. The runtime deep-merges
 * the matching entry onto `config.json` at boot — so this file holds only the
 * values that differ between nodes (s3 bucket, region, replica DB, broadcast
 * peer list, etc).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadDocs, pickServersDoc, transformToV2 } from './lib/configMigration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_INPUT = '/volatile/config/config.json';
const DEFAULT_OUTPUT = resolve(__dirname, '../servers.json');

const { values: args } = parseArgs({
    options: {
        input:  { type: 'string', short: 'i', default: DEFAULT_INPUT },
        output: { type: 'string', short: 'o', default: DEFAULT_OUTPUT },
    },
});

const raw = readFileSync(args.input, 'utf8');
const docs = loadDocs(raw);

const serversDoc = pickServersDoc(docs);
if ( ! serversDoc ) {
    console.error('No `{ servers: [...] }` doc found in input.');
    process.exit(1);
}

const migrated = serversDoc.servers.map(server => {
    const { kernel, ...serverMeta } = server;
    // Start from just the kernel override so the output is a *delta*, not a
    // full merged config. Server-level metadata (id, region) gets hoisted in
    // first so transformToV2 maps `id` → `serverId` and keeps `region`.
    const src = { ...(kernel ?? {}) };
    for ( const k of ['id', 'region'] ) {
        if ( serverMeta[k] !== undefined && src[k] === undefined ) {
            src[k] = serverMeta[k];
        }
    }
    return transformToV2(src);
});

writeFileSync(args.output, JSON.stringify(migrated, null, 2) + '\n');
console.log(`Migrated ${migrated.length} server config(s) → ${args.output}`);

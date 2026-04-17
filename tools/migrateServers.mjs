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
 * Input file must contain both the prod base doc and a `{ servers: [...] }`
 * overrides doc (either concatenated into a single file, or just the
 * servers doc alone if the base has already been migrated — in that case
 * pass the base via --base).
 *
 * Output: an array where each entry is a v2 config = base ⊕ kernel-override.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { deepMerge, loadDocs, pickBaseDoc, pickServersDoc, transformToV2 } from './lib/configMigration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_INPUT = '/volatile/config/config.json';
const DEFAULT_OUTPUT = resolve(__dirname, '../servers.json');

const { values: args } = parseArgs({
    options: {
        input:  { type: 'string', short: 'i', default: DEFAULT_INPUT },
        output: { type: 'string', short: 'o', default: DEFAULT_OUTPUT },
        base:   { type: 'string' },
    },
});

const raw = readFileSync(args.input, 'utf8');
const docs = loadDocs(raw);

const serversDoc = pickServersDoc(docs);
if ( ! serversDoc ) {
    console.error('No `{ servers: [...] }` doc found in input.');
    process.exit(1);
}

// Base may live in the same file (concatenated) or in a separate file.
let baseDoc;
if ( args.base ) {
    const baseRaw = readFileSync(args.base, 'utf8');
    const baseDocs = loadDocs(baseRaw);
    baseDoc = pickBaseDoc(baseDocs);
} else {
    baseDoc = pickBaseDoc(docs);
}
if ( ! baseDoc ) {
    console.error('No base config doc found. Pass --base <path> if base lives in another file.');
    process.exit(1);
}

const migrated = serversDoc.servers.map(server => {
    const { kernel, ...serverMeta } = server;
    const merged = deepMerge(baseDoc, kernel ?? {});
    // Hoist server-level metadata (id, region, host) onto the merged config
    // so it survives transformation.
    for ( const k of ['id', 'region', 'host'] ) {
        if ( serverMeta[k] !== undefined && merged[k] === undefined ) {
            merged[k] = serverMeta[k];
        }
    }
    return transformToV2(merged);
});

writeFileSync(args.output, JSON.stringify(migrated, null, 2) + '\n');
console.log(`Migrated ${migrated.length} server config(s) → ${args.output}`);

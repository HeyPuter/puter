#!/usr/bin/env node
/*
 * Migrate a v1 kernel config into a v2 config.json.
 *
 * Usage:
 *   node tools/migrateConfig.mjs [--input <path>] [--output <path>]
 *
 * Defaults:
 *   --input  /volatile/config/config.json
 *   --output <repo>/packages/puter/config.json
 *
 * The input may be either a single JSON document or several docs
 * concatenated (the old prod layout: base + servers + oss-default).
 * In the multi-doc case the "base" doc is chosen — servers overrides
 * are handled by migrateServers.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadDocs, pickBaseDoc, transformToV2 } from './lib/configMigration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_INPUT = '/volatile/config/config.json';
const DEFAULT_OUTPUT = resolve(__dirname, '../config.json');

const { values: args } = parseArgs({
    options: {
        input:  { type: 'string', short: 'i', default: DEFAULT_INPUT },
        output: { type: 'string', short: 'o', default: DEFAULT_OUTPUT },
    },
});

const raw = readFileSync(args.input, 'utf8');
const docs = loadDocs(raw);
if ( docs.length === 0 ) {
    console.error('No JSON documents found in input.');
    process.exit(1);
}

const base = pickBaseDoc(docs);
if ( ! base ) {
    console.error('Could not identify a base config document in input.');
    process.exit(1);
}

const migrated = transformToV2(base);
writeFileSync(args.output, JSON.stringify(migrated, null, 2) + '\n');
console.log(`Migrated base config → ${args.output}`);

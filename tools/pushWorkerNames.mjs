// Rewrites both push workers' names block from pushNames.js; --check only reports.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withPushNames } from './pushNamesBlock.mjs';

const check = process.argv.includes('--check');
let stale = false;
for (const file of ['src/puter-js/src/push-sw.js', 'src/gui/src/sw.js']) {
    const at = fileURLToPath(new URL(`../${file}`, import.meta.url));
    const source = readFileSync(at, 'utf8');
    const next = withPushNames(source);
    if (next === source) continue;
    stale = true;
    if (check) console.error(`stale push names: ${file}`);
    else writeFileSync(at, next);
}
if (check && stale) process.exit(1);

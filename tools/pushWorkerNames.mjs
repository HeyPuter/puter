// Rewrites the names block in both push workers from pushNames.js.
// `--check` only reports a stale block, and exits 1.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withPushNames } from '../src/puter-js/src/modules/notifications/lib/pushNamesBlock.js';

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

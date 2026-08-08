#!/usr/bin/env node
/**
 * Type-checks the backend and fails on errors that aren't already known.
 *
 * `tsconfig.build.json` sets `noCheck: true`, so `tsc` emits without ever
 * checking types — which is how a call to a function that no longer existed
 * (`effectiveActorApp`) shipped to production and crashed every node that
 * served an AI prompt. The compiler had the error the whole time; nothing ran
 * it.
 *
 * The consuming repo (heyputer) runs an equivalent gate over this project plus
 * its extensions. That one only fires once someone bumps the submodule pointer,
 * which is too late to keep a broken export out of this repo's default branch —
 * so the same check runs here, on this repo's own pull requests. Keep the two
 * scripts behaving the same way; each keeps its own baseline, since the error
 * sets differ with how the project is resolved.
 *
 * Turning checking on wholesale isn't possible yet: there is a real backlog of
 * pre-existing errors (see the baseline). So this runs the check with
 * `--noCheck false`, diffs against that recorded backlog, and fails only on
 * errors that are *new*. The backlog can then be burned down without blocking
 * anyone, and the day it hits zero this becomes a plain `tsc` gate and the
 * `noCheck` flag comes out of the tsconfig.
 *
 * Usage:
 *   node tools/typecheck.mjs            # check; exit 1 on new errors
 *   node tools/typecheck.mjs --update   # rewrite the baseline
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'tools', 'typecheck-baseline.json');
const CONFIG = 'tsconfig.build.json';

// `file(line,col): error TSxxxx: message`
const ERROR_RE = /^(?<file>[^(]+)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<message>.*)$/;

const runTsc = () => {
    try {
        execFileSync(
            'npx',
            ['tsc', '-p', CONFIG, '--noCheck', 'false', '--noEmit'],
            { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return '';
    } catch (e) {
        // tsc exits non-zero when it reports errors; that's the normal path.
        if (e.stdout === undefined && e.stderr === undefined) throw e;
        return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
};

/**
 * Key an error by file and code — deliberately *not* by line number, so
 * unrelated edits above an existing error don't churn the baseline. The message
 * is dropped too: it embeds inferred type text that shifts whenever a nearby
 * signature changes, which would otherwise read as a new error.
 */
const SEP = ' | ';
const keyOf = (file, code) => [file, code].join(SEP);

const collect = () => {
    const counts = new Map();
    const samples = new Map();
    for (const line of runTsc().split('\n')) {
        const m = ERROR_RE.exec(line.trim());
        if (!m) continue;
        const { file, code, message } = m.groups;
        const key = keyOf(file, code);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!samples.has(key)) {
            samples.set(key, `${file}:${m.groups.line} ${code}: ${message}`);
        }
    }
    return { counts, samples };
};

const { counts, samples } = collect();
const update = process.argv.includes('--update');

if (update) {
    const baseline = Object.fromEntries([...counts.entries()].sort());
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(
        `Baseline written: ${total} known errors across ${counts.size} file/code pairs.`,
    );
    process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
    console.error('No baseline found. Run: node tools/typecheck.mjs --update');
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

const regressions = [];
for (const [key, count] of counts) {
    const known = baseline[key] ?? 0;
    if (count > known) regressions.push({ key, count, known });
}

const fixed = [];
for (const [key, known] of Object.entries(baseline)) {
    const count = counts.get(key) ?? 0;
    if (count < known) fixed.push({ key, count, known });
}

if (fixed.length) {
    const net = fixed.reduce((a, f) => a + (f.known - f.count), 0);
    console.log(
        `${net} baselined error(s) fixed. Run \`npm run typecheck:update\` to lock that in.\n`,
    );
}

if (!regressions.length) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`Type check passed — no new errors (${total} known, baselined).`);
    process.exit(0);
}

console.error('New type errors (not in the baseline):\n');
for (const { key, count, known } of regressions) {
    const extra = known ? ` (${known} known, ${count} now)` : '';
    console.error(`  ${samples.get(key)}${extra}`);
}
console.error(
    `\n${regressions.length} new error(s). Fix them, or if they are genuinely` +
        ' pre-existing, run `npm run typecheck:update` and say so in review.',
);
process.exit(1);

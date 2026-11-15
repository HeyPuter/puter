#!/usr/bin/env node
// Runs the checks CI applies to a change, scoped to the files it touched:
// lint, type check, the tests that import those files, and the benchmark
// comparison.
//
//   node tools/check.mjs [<git ref>] [--no-bench]
//
// The ref is the commit to compare with (default: the merge base with
// origin/main). Every step runs even when an earlier one fails; exits 1 if any
// did.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const args = process.argv.slice(2);
const skipBench = args.includes('--no-bench');
const ref = args.find((arg) => !arg.startsWith('--'));

const git = (...gitArgs) => {
    const result = spawnSync('git', gitArgs, {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        console.error(`git ${gitArgs.join(' ')} failed:\n${result.stderr}`);
        process.exit(2);
    }
    return result.stdout.trim();
};

const base = ref ?? git('merge-base', 'HEAD', 'origin/main');
// Committed, staged, unstaged and untracked; deleted files have nothing to check.
const changed = [
    ...git('diff', '--name-only', '--diff-filter=ACMR', base).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean);

const backend = changed.filter((file) =>
    /^(src\/backend|extensions)\/.*\.(js|mjs|cjs|ts)$/.test(file),
);
const sdk = changed.filter((file) => file.startsWith('src/puter-js/'));

const results = [];
const step = (name, command, commandArgs) => {
    console.log(`\n── ${name} ──`);
    const { status } = spawnSync(command, commandArgs, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    results.push({ name, ok: status === 0 });
    return status === 0;
};
const npx = (name, ...commandArgs) => step(name, 'npx', commandArgs);
const npm = (name, script) => step(name, 'npm', ['run', script]);

// The backend loads the built worker library, and the SDK tests the built SDK.
const built =
    (backend.length || sdk.length) &&
    npm('extension setup', 'setupExtensions') &&
    npm('SDK and worker library build', 'build:workerLib');

if (backend.length) {
    npx('lint', 'eslint', '--no-warn-ignored', ...backend);
    npm('type check', 'typecheck');
    if (built) {
        npx(
            'backend tests that import the changed files',
            'vitest',
            'related',
            ...backend,
            '--run',
            '--passWithNoTests',
            '--config',
            'src/backend/vitest.config.ts',
        );
        if (!skipBench) {
            step('benchmarks against the base commit', process.execPath, [
                'tools/bench.mjs',
                'against',
                base,
            ]);
        }
    }
}

if (sdk.length) {
    if (built) npm('SDK tests', 'test:puterjs');
    npm('SDK types', 'check:puterjs:types');
}

if (!results.length) {
    console.log('No backend or SDK files changed; nothing to check.');
    process.exit(0);
}

console.log('');
for (const { name, ok } of results) {
    console.log(`${ok ? 'ok    ' : 'FAILED'}  ${name}`);
}
process.exit(results.every(({ ok }) => ok) ? 0 : 1);

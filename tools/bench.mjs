#!/usr/bin/env node
// Runs the backend benchmarks and compares two runs. See doc/benchmarks.md.
//
//   node tools/bench.mjs run [--out <dir>] [--shard <i>/<n>] [files...]
//   node tools/bench.mjs against [<git ref>] [--out <dir>] [--shard <i>/<n>] [--report-only]
//   node tools/bench.mjs compare <base report or dir> <head report or dir> [--markdown <file>]
//
// `against` runs this checkout's benchmarks on the given ref (default: the
// merge base with origin/main) and on this checkout, then compares the two.
// Both `against` and `compare` exit 1 on a regression that no `bench-accept:`
// line in $BENCH_ACCEPT_TEXT covers.

import { spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    globSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildReport,
    compareReports,
    mergeReports,
    parseAccepted,
    renderMarkdown,
} from './lib/benchReport.mjs';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const BENCH_CONFIG = 'src/backend/vitest.bench.config.ts';
const BENCH_GLOBS = [
    'src/backend/**/*.bench.{js,ts}',
    'extensions/**/*.bench.{js,ts}',
];
// Copied onto the base ref with the bench files, so both sides run one harness.
const HARNESS_FILES = [
    BENCH_CONFIG,
    'src/backend/vitest.config.ts',
    'src/backend/benchUtil.ts',
];
// Resolved on use: `compare` runs without dependencies installed.
const vitestBin = () =>
    path.join(
        path.dirname(
            createRequire(import.meta.url).resolve('vitest/package.json'),
        ),
        'vitest.mjs',
    );

const fail = (message) => {
    console.error(message);
    process.exit(1);
};

/** Splits argv into positionals and `--name value` / `--flag` options. */
const parseArgs = (argv, flags = []) => {
    const positional = [];
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) positional.push(arg);
        else if (flags.includes(arg.slice(2))) options[arg.slice(2)] = true;
        else options[arg.slice(2)] = argv[++i];
    }
    return { positional, options };
};

const git = (args, cwd = repoRoot) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) {
        fail(`git ${args.join(' ')} failed:\n${result.stderr}`);
    }
    return result.stdout.trim();
};

const isNodeModules = (p) => path.basename(String(p)) === 'node_modules';

const listBenchFiles = (root) =>
    globSync(BENCH_GLOBS, { cwd: root, exclude: isNodeModules }).sort();

const shardOf = (files, shard) => {
    if (!shard) return files;
    const [index, total] = shard.split('/').map(Number);
    if (!(index >= 1 && index <= total)) fail(`Bad --shard ${shard}`);
    return files.filter((_, i) => i % total === index - 1);
};

/**
 * Runs `files` under vitest bench in `root` and writes `<outDir>/report.json`.
 * Returns false when vitest exited non-zero; the report then holds whatever
 * completed.
 */
const runBenchmarks = (root, files, outDir) => {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const vitestJson = path.join(outDir, 'vitest.json');
    const ioDir = path.join(outDir, 'io');
    const result = spawnSync(
        process.execPath,
        [
            vitestBin(),
            'bench',
            '--run',
            '--config',
            BENCH_CONFIG,
            '--outputJson',
            vitestJson,
            ...files,
        ],
        {
            cwd: root,
            stdio: 'inherit',
            env: { ...process.env, PUTER_BENCH_IO_DIR: ioDir },
        },
    );
    const sidecars = existsSync(ioDir)
        ? readdirSync(ioDir).map((f) =>
              JSON.parse(readFileSync(path.join(ioDir, f), 'utf8')),
          )
        : [];
    const report = buildReport(
        existsSync(vitestJson)
            ? JSON.parse(readFileSync(vitestJson, 'utf8'))
            : { files: [] },
        sidecars,
        (filepath) => path.relative(root, filepath),
    );
    writeFileSync(
        path.join(outDir, 'report.json'),
        JSON.stringify(report, null, 2),
    );
    return result.status === 0;
};

/** A report file, or every `*.json` report directly inside a directory. */
const loadReport = (target) => {
    if (!existsSync(target)) fail(`No benchmark report at ${target}`);
    if (!statSync(target).isDirectory())
        return JSON.parse(readFileSync(target, 'utf8'));
    return mergeReports(
        readdirSync(target)
            .filter((f) => f.endsWith('.json'))
            .map((f) => JSON.parse(readFileSync(path.join(target, f), 'utf8'))),
    );
};

const compare = (baseReport, headReport, markdownPath) => {
    const comparisons = compareReports(baseReport, headReport, {
        accepted: parseAccepted(process.env.BENCH_ACCEPT_TEXT ?? ''),
    });
    const markdown = renderMarkdown(comparisons);
    if (markdownPath) writeFileSync(markdownPath, markdown);
    console.log(markdown);
    return comparisons.filter((c) => c.status === 'regression').length;
};

/**
 * Checks `ref` out under `.bench/base-src` with this checkout's bench files and
 * harness on top. It sits inside the repo so module resolution reaches this
 * checkout's dependencies; nested `node_modules` are linked across.
 */
const prepareBase = (ref, files) => {
    const baseDir = path.join(repoRoot, '.bench/base-src');
    const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]);
    if (existsSync(path.join(baseDir, '.git'))) {
        git(['checkout', '--force', '--detach', sha], baseDir);
        git(['clean', '-fdq', '-e', 'node_modules', '-e', 'dist'], baseDir);
    } else {
        git(['worktree', 'prune']);
        rmSync(baseDir, { recursive: true, force: true });
        git(['worktree', 'add', '--force', '--detach', baseDir, sha]);
    }

    for (const file of [...HARNESS_FILES, ...files]) {
        cpSync(path.join(repoRoot, file), path.join(baseDir, file));
    }
    const lock = (root) =>
        readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    if (lock(baseDir) !== lock(repoRoot)) {
        console.warn(
            "package-lock.json differs from the base; both runs use this checkout's dependencies.",
        );
    }
    // Nested dependency folders and build output the backend reads at boot.
    const linked = globSync(
        ['src/*/node_modules', 'extensions/*/node_modules', 'src/*/dist'],
        { cwd: repoRoot },
    );
    for (const dir of linked) {
        const target = path.join(baseDir, dir);
        if (existsSync(target) || !existsSync(path.dirname(target))) continue;
        symlinkSync(path.join(repoRoot, dir), target, 'dir');
    }
    return { baseDir, sha };
};

const [command, ...rest] = process.argv.slice(2);

if (command === 'run') {
    const { positional, options } = parseArgs(rest);
    const files = positional.length
        ? positional
        : shardOf(listBenchFiles(repoRoot), options.shard);
    const outDir = path.resolve(options.out ?? '.bench/head');
    const ok = runBenchmarks(repoRoot, files, outDir);
    console.log(`Report: ${path.join(outDir, 'report.json')}`);
    process.exit(ok ? 0 : 1);
} else if (command === 'against') {
    const { positional, options } = parseArgs(rest, ['report-only']);
    const ref = positional[0] ?? git(['merge-base', 'HEAD', 'origin/main']);
    const outDir = path.resolve(options.out ?? '.bench');
    const files = shardOf(listBenchFiles(repoRoot), options.shard);
    if (files.length === 0) {
        console.log('No benchmark files in this shard.');
        process.exit(0);
    }

    const { baseDir, sha } = prepareBase(ref, files);
    console.log(`\n-- base ${sha.slice(0, 9)} --`);
    // A benchmark the base cannot run yet reports as new, not as a failure.
    runBenchmarks(baseDir, files, path.join(outDir, 'base'));
    console.log('\n-- this checkout --');
    if (!runBenchmarks(repoRoot, files, path.join(outDir, 'head'))) {
        fail('Benchmarks failed on this checkout.');
    }
    const regressions = compare(
        loadReport(path.join(outDir, 'base/report.json')),
        loadReport(path.join(outDir, 'head/report.json')),
        path.join(outDir, 'comparison.md'),
    );
    process.exit(regressions && !options['report-only'] ? 1 : 0);
} else if (command === 'compare') {
    const { positional, options } = parseArgs(rest);
    if (positional.length !== 2)
        fail('Usage: bench.mjs compare <base> <head> [--markdown <file>]');
    const regressions = compare(
        loadReport(positional[0]),
        loadReport(positional[1]),
        options.markdown,
    );
    process.exit(regressions ? 1 : 0);
} else {
    fail('Usage: bench.mjs <run|against|compare> ... (see doc/benchmarks.md)');
}

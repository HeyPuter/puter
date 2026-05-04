#!/usr/bin/env node
// Install dependencies for every subfolder under ./extensions/.
// Runs installs in parallel; uses `npm ci` when a lockfile is present,
// otherwise falls back to `npm install`. Cross-platform replacement for
// the previous bash version.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const EXT_DIR = './extensions';

if (!existsSync(EXT_DIR)) {
    process.exit(0);
}

const dirs = readdirSync(EXT_DIR)
    .map((name) => join(EXT_DIR, name))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => existsSync(join(p, 'package.json')));

if (dirs.length === 0) {
    process.exit(0);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function install(dir) {
    return new Promise((resolve, reject) => {
        const args = existsSync(join(dir, 'package-lock.json')) ? ['ci'] : ['install'];
        console.log(`[${dir}] starting npm ${args.join(' ')}`);
        const child = spawn(npmCmd, args, { cwd: dir });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('error', reject);
        child.on('close', (code) => {
            if (out) process.stdout.write(out);
            if (code === 0) {
                console.log(`[${dir}] done`);
                resolve();
            } else {
                reject(new Error(`[${dir}] npm ${args.join(' ')} exited with code ${code}`));
            }
        });
    });
}

const results = await Promise.allSettled(dirs.map(install));
const failures = results
    .map((r, i) => ({ r, dir: dirs[i] }))
    .filter(({ r }) => r.status === 'rejected');

if (failures.length > 0) {
    for (const { r, dir } of failures) {
        console.error(`[${dir}] ${r.reason?.message ?? r.reason}`);
    }
    process.exit(1);
}

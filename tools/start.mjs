#!/usr/bin/env node
// Entry point for `npm start`.
//
// Default: build and run the self-hosted backend.
//
// With a server flag, the local backend is skipped entirely and the GUI is
// served locally against that remote Puter backend:
//
//     npm start --server=puter.com
//     npm start -- --server=puter.com
//     npm start -- --server=http://puter.localhost:4100
//
// A bare domain resolves to the production convention `https://api.<domain>`;
// a full origin (or an `api.`-prefixed host) is used verbatim.
//
// `--extensions=<dir>[;<dir>...]` bundles out-of-tree GUI extension
// directories into the served GUI (sugar for PUTER_GUI_EXTENSION_PATHS),
// so proprietary extensions can live outside this repository:
//
//     npm start --server=puter.com --extensions=../puter-private/gui-extensions

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// `npm start --flag=x` arrives as the npm_config_<flag> env var;
// `npm start -- --flag=x` arrives as a regular argument.
const getFlag = (name) => {
    for ( const arg of process.argv.slice(2) ) {
        if ( arg.startsWith(`--${name}=`) ) return arg.slice(name.length + 3);
    }
    return process.env[`npm_config_${name}`] || null;
};

// Relative paths resolve against where `npm start` was invoked (INIT_CWD),
// not the repo root npm runs scripts from.
const resolveExtensionPaths = (value) => value
    .split(';')
    .filter(Boolean)
    .map(p => path.resolve(process.env.INIT_CWD ?? process.cwd(), p))
    .join(';');

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: rootDir, ...opts });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
        if ( code === 0 || signal ) resolve();
        else reject(new Error(`\`${[cmd, ...args].join(' ')}\` exited with code ${code}`));
    });
});

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const server = getFlag('server');
const extensions = getFlag('extensions');

try {
    if ( server ) {
        const args = ['dev-server.js', `--server=${server}`];
        if ( extensions ) args.push(`--extensions=${resolveExtensionPaths(extensions)}`);
        await run(process.execPath, args, {
            cwd: path.join(rootDir, 'src', 'gui'),
        });
    } else {
        if ( extensions ) {
            console.warn('--extensions only applies to --server (GUI-only) mode; ignoring.');
        }
        await run(npm, ['run', 'setupExtensions']);
        await run(npm, ['run', 'build:ts']);
        await run(process.execPath, [
            '--enable-source-maps',
            '-r', './dist/src/backend/telemetry.js',
            './dist/src/backend/index.js',
        ]);
    }
} catch (err) {
    console.error(err.message);
    process.exit(1);
}

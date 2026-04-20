import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
writeFileSync(
    'dist/package.json',
    `${JSON.stringify({
        name: '@heyputer/backend',
        type: 'commonjs',
        exports: {
            // New-style exports (post-flatten). Preferred for any code
            // authored after the src/backend/src → src/backend move.
            './core': './src/backend/core/index.js',
            './core/http': './src/backend/core/http/index.js',
            './extensions': './src/backend/extensions.js',
            // Legacy `@heyputer/backend/src/*` import strings. Two
            // patterns so both extensionless (TS-compiled requires drop
            // the `.js`) and extensioned (hand-written JS) subpaths map
            // to the right compiled file. Node picks the more specific
            // pattern when both match, so `./src/*.js` wins for `.js`
            // suffixes and the bare `./src/*` handles everything else.
            './src/core': './src/backend/core/index.js',
            './src/core/http': './src/backend/core/http/index.js',
            './src/extensions': './src/backend/extensions.js',
            './src/*.js': './src/backend/*.js',
            './src/*': './src/backend/*.js',
        },
    }, null, 2)}\n`,
);

// tsc only emits .js for .ts inputs. Non-source files the runtime needs
// (SQL migrations + .dbmig.js scripts resolved relative to __dirname) have
// to be copied over by hand — otherwise `SqliteDatabaseClient.runMigrations`
// throws ENOENT on first boot.
const COPY_DIRS = [
    ['src/backend/clients/database/migrations', 'dist/src/backend/clients/database/migrations'],
];
for ( const [from, to] of COPY_DIRS ) {
    if ( ! existsSync(from) ) continue;
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
}

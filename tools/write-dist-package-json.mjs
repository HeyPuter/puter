import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
writeFileSync(
    'dist/package.json',
    `${JSON.stringify({
        name: '@heyputer/backend',
        type: 'module',
        exports: {
            // Post-flatten: `src/backend/` is the backend root. The `src/`
            // in the compiled path (`dist/src/backend/...`) is an artifact
            // of tsc's rootDir being the package root, not a meaningful
            // subfolder. Canonical imports drop the `/src/` prefix — e.g.
            // `@heyputer/backend/controllers/types`. Named shortcuts for
            // the common entry points come first (Node picks the most
            // specific pattern match).
            './core': './src/backend/core/index.js',
            './core/http': './src/backend/core/http/index.js',
            './extensions': './src/backend/extensions.js',
            // Dual-form patterns so both extensionless (TS-compiled
            // requires drop `.js`) and extensioned (hand-written JS)
            // subpaths resolve.
            './*.js': './src/backend/*.js',
            './*': './src/backend/*.js',
            // Back-compat for the older `@heyputer/backend/src/*` style.
            // Safe to keep indefinitely; remove once every extension has
            // been rewritten.
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

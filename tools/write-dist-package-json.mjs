import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
writeFileSync(
    'dist/package.json',
    `${JSON.stringify({
        name: '@heyputer/backend',
        type: 'commonjs',
        exports: {
            './src/core': './src/backend/src/core/index.js',
            './src/core/http': './src/backend/src/core/http/index.js',
            './src/extensions': './src/backend/src/extensions.js',
        },
    }, null, 2)}\n`,
);

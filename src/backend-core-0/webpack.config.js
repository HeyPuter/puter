import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ESM build
const esmConfig = {
    mode: 'production',
    entry: './src/exports.js',
    experiments: {
        outputModule: true,
    },
    output: {
        path: path.resolve(__dirname, 'dist/esm'),
        filename: 'exports.js',
        module: true,
        library: {
            type: 'module',
        },
    },
    optimization: {
        minimize: false,
    },
    resolve: {
        extensions: ['.js', '.mjs'],
        fullySpecified: false,
    },
    target: 'node',
};

// CJS build
const cjsConfig = {
    mode: 'production',
    entry: './src/exports.js',
    output: {
        path: path.resolve(__dirname, 'dist/cjs'),
        filename: 'exports.cjs',
        library: {
            type: 'commonjs2',
        },
    },
    optimization: {
        minimize: false,
    },
    resolve: {
        extensions: ['.js', '.mjs'],
        fullySpecified: false,
    },
    target: 'node',
};

export default [esmConfig, cjsConfig];


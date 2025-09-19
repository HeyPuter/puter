import path from 'node:path';
import webpack from 'webpack';

// '__dirname' isn't defined by default in ES modules.
// We didn't really want to migrate this file to ESM because
// it's config for tooling that only runs in node, but alas
// if package.json says "type": "module" then we have to use
// ESM syntax everywhere unless we rename this to a .cjs file
// and add an extra flag everywhere we use webpack.
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    entry: './src/index.js',
    output: {
        filename: 'puter.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new webpack.DefinePlugin({
            'globalThis.PUTER_ORIGIN': JSON.stringify(process.env.PUTER_ORIGIN || 'https://puter.com'),
            'globalThis.PUTER_API_ORIGIN': JSON.stringify(process.env.PUTER_API_ORIGIN || 'https://api.puter.com'),
        }),
    ],
};

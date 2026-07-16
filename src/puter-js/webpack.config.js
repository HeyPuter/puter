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

export default (env = {}) => ({
    entry: './src/index.js',
    output: {
        filename: 'puter.js',
        path: path.resolve(__dirname, 'dist'),
    },
    // `--env coverage` instruments every first-party module with istanbul
    // counters (accumulated on `globalThis.__coverage__`), so the API test
    // harness can measure SDK coverage in whatever runtime executes the
    // bundle. Vendored code (socket.io) is left out of the numbers.
    ...(env.coverage ? {
        module: {
            rules: [
                {
                    test: /\.js$/,
                    include: path.resolve(__dirname, 'src'),
                    exclude: path.resolve(__dirname, 'src/lib/socket.io'),
                    use: {
                        loader: 'babel-loader',
                        options: {
                            babelrc: false,
                            configFile: false,
                            plugins: [
                                [
                                    'babel-plugin-istanbul',
                                    {
                                        // istanbul's default global lookup
                                        // is `new Function('return this')`,
                                        // which workerd forbids (no dynamic
                                        // code generation). Address the
                                        // global directly — `self` first,
                                        // because the worker preamble runs
                                        // the SDK under `with (context)`
                                        // where `globalThis` is shadowed by
                                        // the sandbox while `self` still
                                        // reaches the true global.
                                        coverageGlobalScope:
                                            "typeof self !== 'undefined' ? self : globalThis",
                                        coverageGlobalScopeFunc: false,
                                    },
                                ],
                            ],
                        },
                    },
                },
            ],
        },
    } : {}),
    plugins: [
        new webpack.DefinePlugin({
            'globalThis.PUTER_ORIGIN_ENV': JSON.stringify(process.env.PUTER_ORIGIN || 'https://puter.com'),
            'globalThis.PUTER_API_ORIGIN_ENV': JSON.stringify(process.env.PUTER_API_ORIGIN || 'https://api.puter.com'),
        }),
    ],
});

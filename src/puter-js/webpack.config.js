import { readFileSync } from 'node:fs';
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

// `push-sw.js` is a standalone classic script apps import into their own service worker; it ships next to the bundle as-is.
const PUSH_WORKER = path.resolve(__dirname, 'src/push-sw.js');
class EmitPushWorker {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('EmitPushWorker', (compilation) => {
            compilation.fileDependencies.add(PUSH_WORKER);
            compilation.hooks.processAssets.tap(
                { name: 'EmitPushWorker', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
                () => {
                    compilation.emitAsset('push-sw.js', new webpack.sources.RawSource(readFileSync(PUSH_WORKER, 'utf8')));
                },
            );
        });
    }
}

export default (env = {}) => ({
    entry: './src/index.js',
    output: {
        filename: 'puter.js',
        path: path.resolve(__dirname, 'dist'),
    },
    // `--env coverage` instruments every first-party module with istanbul
    // counters (accumulated on `globalThis.__coverage__`), so the API test
    // harness can measure SDK coverage in whatever runtime executes the
    // bundle.
    ...(env.coverage ? {
        module: {
            rules: [
                {
                    test: /\.js$/,
                    include: path.resolve(__dirname, 'src'),
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
        new EmitPushWorker(),
        new webpack.DefinePlugin({
            'globalThis.PUTER_ORIGIN_ENV': JSON.stringify(process.env.PUTER_ORIGIN || 'https://puter.com'),
            'globalThis.PUTER_API_ORIGIN_ENV': JSON.stringify(process.env.PUTER_API_ORIGIN || 'https://api.puter.com'),
        }),
    ],
});

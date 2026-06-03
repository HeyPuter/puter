// Forked from src/worker/webpack.config.cjs.
// Bundles src/index.js (router + MCP routes) into dist/webpackPreamplePart.js,
// which buildPreamble.mjs then inlines alongside puter.js into the final
// service-worker preamble (dist/workerPreamble.js).
const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'webpackPreamplePart.js',
        library: {
            type: 'var',
            name: 'WorkerPreamble',
        },
        globalObject: 'this',
    },
    mode: 'production',
    target: 'webworker',
    resolve: {
        extensions: ['.js'],
    },
    externals: {
        'https://puter-net.b-cdn.net/rustls.js': 'undefined',
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    keep_fnames: true,
                    mangle: {
                        keep_fnames: true,
                    },
                    compress: {
                        keep_fnames: true,
                    },
                },
            }),
        ],
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /puter\.js$/,
                parser: {
                    dynamicImports: false,
                },
            },
        ],
    },
    plugins: [
        new webpack.BannerPlugin({
            banner: '// This file is pasted before user code',
            raw: false,
            entryOnly: false,
        }),
    ],
};

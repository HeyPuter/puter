const path = require('path');
const webpack = require('webpack');

module.exports = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'webpackPreamplePart.js',
        library: {
            type: 'var',
            name: 'WorkerPreamble'
        },
        globalObject: 'this'
    },
    mode: 'production',
    target: 'webworker',
    resolve: {
        extensions: ['.js'],
    },
    externals: {
        'https://puter-net.b-cdn.net/rustls.js': 'undefined'
    },
    optimization: {
        minimize: true,
        minimizer: [
            new (require('terser-webpack-plugin'))({
                terserOptions: {
                    keep_fnames: true,
                    mangle: {
                        keep_fnames: true
                    },
                    compress: {
                        keep_fnames: true
                    }
                }
            })
        ]
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /puter\.js$/,
                parser: {
                    dynamicImports: false
                }
            }
        ]
    },
    plugins: [
        new webpack.BannerPlugin({
            banner: '// This file is pasted before user code',
            raw: false,
            entryOnly: false
        })
    ]
}; 
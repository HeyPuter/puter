const HtmlWebpackPlugin = require('html-webpack-plugin');
const DefinePlugin = require('webpack').DefinePlugin;
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: [
        './src/main.js'
    ],
    plugins: [
        new HtmlWebpackPlugin({
            template: 'assets/template.html'
        }),
        new DefinePlugin({
            MODE: JSON.stringify(process.env.MODE ?? 'dev')
        }),
        new CopyPlugin({
            patterns: [
                { from: 'benchmark', to: 'static' },
                { from: 'tux.sixel', to: 'static' },
            ]
        })
    ]
};

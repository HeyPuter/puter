const HtmlWebpackPlugin = require('html-webpack-plugin');
const DefinePlugin = require('webpack').DefinePlugin;

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
    ]
};

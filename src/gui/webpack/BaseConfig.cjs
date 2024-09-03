const path = require('path');
const EmitPlugin = require('./EmitPlugin.cjs');
module.exports = async (options = {}) => {
    const config = {};
    config.entry = [
        './src/init_sync.js',
        './src/init_async.js',
        './src/initgui.js',
        './src/helpers.js',
        './src/IPC.js',
        './src/globals.js',
        './src/i18n/i18n.js',
        './src/keyboard.js',
        './src/index.js',
    ];
    config.output = {
        path: path.resolve(__dirname, '../dist'),
        filename: 'bundle.min.js',
    };
    config.plugins = [
        await EmitPlugin({
            options,
            dir: path.join(__dirname, '../src/icons'),
        }),
    ];
    return config;
};

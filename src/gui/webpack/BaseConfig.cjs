const path = require('path');
const fs = require('fs');
const EmitPlugin = require('./EmitPlugin.cjs');

module.exports = async (options = {}) => {
    // Directory containing extension files
    const extensionsDir = path.join(__dirname, '../src/extensions');

    // Read and process extension entries from the extensions directory
    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
        .map(entry => {
            // Case 1: Direct JavaScript files in extensions directory
            if (entry.isFile() && entry.name.endsWith('.js')) {
                return `./src/extensions/${entry.name}`;
            }
            // Case 2: Extension directories with index.js files
            if (entry.isDirectory()) {
                const indexPath = path.join(extensionsDir, entry.name, 'index.js');
                // Check if directory contains an index.js file
                if (fs.existsSync(indexPath)) {
                    return `./src/extensions/${entry.name}/index.js`;
                }
            }
            // Skip entries that don't match either case
            return null;
        })
        // Remove null entries from the array
        .filter(entry => entry !== null);

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
        ...entries,
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
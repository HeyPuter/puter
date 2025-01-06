/*
 * Copyright (C) 2024 Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const path = require('path');
const fs = require('fs');
const EmitPlugin = require('./EmitPlugin.cjs');

module.exports = async (options = {}) => {
    const extension_directories = [];
    
    extension_directories.push(path.join(__dirname, '../src/extensions'));
    
    if ( process.env.PUTER_GUI_EXTENSION_PATHS ) {
        const paths = process.env.PUTER_GUI_EXTENSION_PATHS.split(';');
        extension_directories.push(...paths);
    }

    const entries = [];

    for ( const extensionsDir of extension_directories ) {
        console.log(`Reading extensions from ${extensionsDir}`);
        // Read and process extension entries from the extensions directory
        const readdir_entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
        for ( const entry of readdir_entries ) {
            // Case 1: Direct JavaScript files in extensions directory
            if (entry.isFile() && entry.name.endsWith('.js')) {
                const entry_path = path.join(extensionsDir, entry.name);
                entries.push(entry_path);
                continue;
            }
            // Case 2: Extension directories with index.js files
            if (entry.isDirectory()) {
                const indexPath = path.join(extensionsDir, entry.name, 'index.js');
                // Check if directory contains an index.js file
                if (fs.existsSync(indexPath)) {
                    entries.push(indexPath);
                    continue;
                }
            }
        }
    }

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
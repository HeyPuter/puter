/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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
const webpack = require('webpack');
const EmitPlugin = require('./EmitPlugin.cjs');

module.exports = async (options = {}) => {
    const extension_directories = [];

    extension_directories.push(path.join(__dirname, '../src/extensions'));

    // Out-of-tree extension directories (e.g. proprietary extensions kept in
    // a separate repository).
    const externalDirs = [];
    if ( process.env.PUTER_GUI_EXTENSION_PATHS ) {
        const paths = process.env.PUTER_GUI_EXTENSION_PATHS.split(';');
        externalDirs.push(...paths.filter(Boolean).map(p => path.resolve(p)));
        extension_directories.push(...externalDirs);
    }

    // Imports in out-of-tree extensions resolve as if the extension lived in
    // src/extensions — so `../UI/UIAlert.js` reaches GUI internals the same
    // way it does in-tree — while files that exist next to the extension
    // (its own libs) still win.
    const srcDir = path.join(__dirname, '../src');
    const resolvesTo = (p) => fs.existsSync(p) || fs.existsSync(`${p}.js`);
    const remapExternalImport = (resource) => {
        const issuerDir = resource.context;
        const root = externalDirs.find(dir =>
            issuerDir === dir || issuerDir.startsWith(dir + path.sep));
        if ( ! root ) return;
        if ( resolvesTo(path.resolve(issuerDir, resource.request)) ) return;
        const virtualDir = path.join(srcDir, 'extensions', path.relative(root, issuerDir));
        const target = path.resolve(virtualDir, resource.request);
        if ( resolvesTo(target) ) resource.request = target;
    };

    const entries = [];

    for ( const extensionsDir of extension_directories ) {
        if ( ! fs.existsSync(extensionsDir) ) continue;
        // Read and process extension entries from the extensions directory
        const readdir_entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
        for ( const entry of readdir_entries ) {
            // Case 1: Direct JavaScript files in extensions directory
            if ( entry.isFile() && entry.name.endsWith('.js') ) {
                const entry_path = path.join(extensionsDir, entry.name);
                entries.push(entry_path);
                continue;
            }
            // Case 2: Extension directories with index.js files
            if ( entry.isDirectory() ) {
                const indexPath = path.join(extensionsDir, entry.name, 'index.js');
                // Check if directory contains an index.js file
                if ( fs.existsSync(indexPath) ) {
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
    config.resolve = {
        modules: [
            'node_modules',
            // Hoisted workspace deps: bare imports in out-of-tree extensions
            // can't reach this repo's node_modules by walking up from their
            // own location.
            path.join(__dirname, '../../../node_modules'),
        ],
    };
    config.plugins = [
        ...(externalDirs.length
            ? [new webpack.NormalModuleReplacementPlugin(/^\.\.?\//, remapExternalImport)]
            : []),
        await EmitPlugin({
            options,
            dir: path.join(__dirname, '../src/icons'),
        }),
    ];
    return config;
};
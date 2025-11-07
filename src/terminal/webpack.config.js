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
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ResolveExtensionsPlugin from './webpack-resolve-extensions-plugin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configFile = process.env.CONFIG_FILE ?? 'config/dev.js';
const configPath = path.resolve(__dirname, configFile);

// Read and evaluate config file manually to avoid webpack processing it
const configContent = fs.readFileSync(configPath, 'utf-8');
// Create a safe context to evaluate the config
const configContext = { globalThis: { __CONFIG__: {} } };
// Evaluate the config file in a controlled way
eval(configContent.replace(/globalThis\.__CONFIG__/g, 'configContext.globalThis.__CONFIG__'));

// Capture config values at build time
const sdkUrl = process.env.PUTER_JS_URL ?? 
    (configContext.globalThis.__CONFIG__?.sdk_url ?? '');

export default {
    mode: 'development',
    entry: './src/main.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js',
        iife: true,
    },
    resolve: {
        modules: [path.resolve(__dirname, '..'), 'node_modules'],
        extensions: ['.js', '.mjs', '.json'],
    },
    plugins: [
        new ResolveExtensionsPlugin(),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'assets/index.html',
                    to: 'index.html',
                    transform: (content) => {
                        return content.toString().replace('__SDK_URL__', sdkUrl);
                    },
                },
                { from: 'assets/normalize.css', to: 'normalize.css' },
                { from: 'assets/style.css', to: 'style.css' },
                { from: 'assets/xterm.css', to: 'xterm.css' },
                {
                    from: configFile,
                    to: 'config.js',
                },
            ],
        }),
    ],
};


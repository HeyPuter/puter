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

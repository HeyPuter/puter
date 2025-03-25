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

const WebShortcutsService = require('./index');

module.exports = {
    name: 'web-shortcuts',
    version: '1.0.0',
    description: 'Create web shortcuts on the desktop',
    author: 'Puter',
    license: 'MIT',
    dependencies: ['fs', 'path'],
    init: async (puter) => {
        const service = new WebShortcutsService(puter);
        await service.init();
        return service;
    },
    routes: {
        '/mods/web-shortcuts': {
            GET: (req, res) => {
                res.sendFile(__dirname + '/public/main.js');
            }
        }
    }
}; 
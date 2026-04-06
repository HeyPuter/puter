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

class CustomPuterService extends use.Service {
    async _init () {
        const svc_commands = this.services.get('commands');
        this._register_commands(svc_commands);

        const svc_puterHomepage = this.services.get('puter-homepage');
        svc_puterHomepage.register_script('/custom-gui/main.js');
    }
    '__on_install.routes' (_, { app }) {
        const require = this.require;
        const express = require('express');
        const path_ = require('path');

        app.use(
            '/custom-gui',
            express.static(path.join(__dirname, 'gui')),
        );
    }
    _register_commands (commands) {
        commands.registerCommands('o', [
            {
                id: 'k',
                description: '',
                handler: async (_, log) => {
                    log.log('kdmod is enabled');
                },
            },
        ]);
    }
}

module.exports = { CustomPuterService };

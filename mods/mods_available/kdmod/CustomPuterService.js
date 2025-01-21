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
    ['__on_install.routes'] (_, { app }) {
        const require = this.require;
        const express = require('express');
        const path_ = require('path');

        app.use('/custom-gui',
            express.static(path.join(__dirname, 'gui')));
    }
    async ['__on_boot.consolidation'] () {
        const then = Date.now();
        this.tod_widget = () => {
            const s = 5 - Math.floor(
                (Date.now() - then) / 1000);
            const lines = [
                "\x1B[36;1mKDMOD ENABLED\x1B[0m" +
                ` (👁️ ${s}s)`
            ];
            // It would be super cool to be able to use this here
            // surrounding_box('33;1', lines);
            return lines;
        }

        const svc_devConsole = this.services.get('dev-console', { optional: true });
        if ( ! svc_devConsole ) return;
        svc_devConsole.add_widget(this.tod_widget);
        
        setTimeout(() => {
            svc_devConsole.remove_widget(this.tod_widget);
        }, 5000)
    }

    _register_commands (commands) {
        commands.registerCommands('o', [
            {
                id: 'k',
                description: '',
                handler: async (_, log) => {
                    const svc_devConsole = this.services.get('dev-console', { optional: true });
                    if ( ! svc_devConsole ) return;
                    svc_devConsole.remove_widget(this.tod_widget);
                    const lines = this.tod_widget();
                    for ( const line of lines ) log.log(line);
                    this.tod_widget = null;
                }
            }
        ]);
    }
}

module.exports = { CustomPuterService };
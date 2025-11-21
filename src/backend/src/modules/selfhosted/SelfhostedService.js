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
const { Actor } = require('../../services/auth/Actor');
const BaseService = require('../../services/BaseService');
const { DB_WRITE } = require('../../services/database/consts');
const { Context } = require('../../util/context');

class SelfhostedService extends BaseService {
    static description = `
        Registers drivers for self-hosted Puter instances.
    `;

    async _init () {
        this._register_commands(this.services.get('commands'));
    }

    _register_commands (commands) {
        const db = this.services.get('database').get(DB_WRITE, 'selfhosted');
        commands.registerCommands('app', [
            {
                id: 'godmode-on',
                description: 'Toggle godmode for an app',
                handler: async (args, log) => {
                    const svc_su = this.services.get('su');
                    await await svc_su.sudo(async () => {
                        const [app_uid] = args;
                        const es_app = await this.services.get('es:app');
                        const app = await es_app.read(app_uid);
                        if ( ! app ) {
                            throw new Error(`App ${app_uid} not found`);
                        }
                        await db.write('UPDATE apps SET godmode = 1 WHERE uid = ?', [app_uid]);
                    });
                },
            },
        ]);
        commands.registerCommands('app', [
            {
                id: 'godmode-off',
                description: 'Toggle godmode for an app',
                handler: async (args, log) => {
                    const svc_su = this.services.get('su');
                    await await svc_su.sudo(async () => {
                        const [app_uid] = args;
                        const es_app = await this.services.get('es:app');
                        const app = await es_app.read(app_uid);
                        if ( ! app ) {
                            throw new Error(`App ${app_uid} not found`);
                        }
                        await db.write('UPDATE apps SET godmode = 0 WHERE uid = ?', [app_uid]);
                    });
                },
            },
        ]);
    }
}

module.exports = { SelfhostedService };

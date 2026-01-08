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

const BaseService = require('../../services/BaseService');
const { DB_READ } = require('../../services/database/consts');

const N_MONTHS = 4;

class OldAppNameService extends BaseService {
    static LOG_DEBUG = true;

    _init () {
        this.db = this.services.get('database').get(DB_READ, 'old-app-name');
    }

    async ['__on_boot.consolidation'] () {
        const svc_event = this.services.get('event');
        svc_event.on('app.rename', async (_, { app_uid, old_name }) => {
            this.log.info('GOT EVENT', { app_uid, old_name });
            await this.db.write('INSERT INTO `old_app_names` (`app_uid`, `name`) VALUES (?, ?)',
                            [app_uid, old_name]);
        });
    }

    async check_app_name (name) {
        const rows = await this.db.read('SELECT * FROM `old_app_names` WHERE `name` = ?',
                        [name]);

        if ( rows.length === 0 ) return;

        // Check if the app has been renamed in the last N months
        const [row] = rows;
        const timestamp = row.timestamp instanceof Date ? row.timestamp : new Date(
                        // Ensure timestamp ir processed as UTC
                        row.timestamp.endsWith('Z') ? row.timestamp : `${row.timestamp }Z`);

        const age = Date.now() - timestamp.getTime();

        // const n_ms = 60 * 1000;
        const n_ms = N_MONTHS * 30 * 24 * 60 * 60 * 1000;
        this.log.info('AGE INFO', {
            input_time: row.timestamp,
            age,
            n_ms,
        });
        if ( age > n_ms ) {
            // Remove record
            await this.db.write('DELETE FROM `old_app_names` WHERE `id` = ?',
                            [row.id]);
            // Return undefined
            return;
        }

        return {
            id: row.id,
            app_uid: row.app_uid,
        };
    }

    async remove_name (id) {
        await this.db.write('DELETE FROM `old_app_names` WHERE `id` = ?',
                        [id]);
    }
}

module.exports = {
    OldAppNameService,
};

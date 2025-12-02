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

const BaseService = require('./BaseService');
const { asyncSafeSetInterval } = require('@heyputer/putility').libs.promise;
const { MINUTE } = require('@heyputer/putility').libs.time;
const { DB_WRITE } = require('./database/consts');
const { get_user } = require('../helpers');


class TrashAutoDeleteService extends BaseService {

    async _init() {
        this.db = await this.services
            .get('database')
            .get(DB_WRITE, 'trash-auto-delete');

        if (!this._scheduleFn) this._scheduleFn = asyncSafeSetInterval;

        // Run every 15 seconds for testing (change to 30 minutes for prod)
        this._scheduleFn(async () => {
            await this._runCleanup();
        }, 30 * MINUTE);
    }

    async _runCleanup() {
        try {
            this.log.info("TrashAutoDeleteService: Checking users…");

            const users = await this.db.read(`
                SELECT id, trash_uuid
                FROM user
                WHERE trash_uuid IS NOT NULL
            `);

            for (const user of users) {
                await this._cleanupUser(user);
            }

        } catch (e) {
            this.log.error("TrashAutoDeleteService failed:");
            this.log.error(e);
        }
    }

    async _getUserPref(userId) {
        const rows = await this.db.read(`
            SELECT value FROM kv
            WHERE user_id = ?
              AND kkey = 'auto_delete_days'
            LIMIT 1
        `, [userId]);

        if (!rows || rows.length === 0) return 0;

        const n = parseInt(JSON.parse(rows[0].value));
        return (!isNaN(n) && n > 0) ? n : 0;
    }

    async _cleanupUser(userRecord) {
        const { id: userId, trash_uuid } = userRecord;

        const userObj = await get_user({ id: userId });
        if (!userObj) return;

        const prefDays = await this._getUserPref(userId);
        if ( ! prefDays ) return;

        const now = Date.now();
        const DAY_MS = 86400000;

        const files = await this.db.read(`
            SELECT uuid, created
            FROM fsentries
            WHERE parent_uid = ?
              AND is_dir = 0
        `, [trash_uuid]);

        this.log.info(`TrashAutoDeleteService: User ${userId}, trash=${files.length} file(s)`);

        let deletedCount = 0;

        for ( const f of files ) {
            const ageDays = (now - (f.created * 1000)) / DAY_MS;
            // const ageDays = 3; // Used for testing!

            if ( ageDays < prefDays ) continue;

            try {
                await this._deleteOne(userObj, f.uuid);
                deletedCount++;

            } catch (err) {
                this.log.error(`TrashAutoDeleteService: failed deleting ${f.uuid} for user ${userId}`);
                this.log.error(err);
            }
        }

        this.log.info(`TrashAutoDeleteService: user ${userId}, deleted ${deletedCount} file(s)`);
    }

    /**
     * Properly deletes a single UUID using HLRemove inside a proper Context.
     */
    async _deleteOne(userObj, uuid) {
        const username = userObj.username;
        const path = `/${username}/Trash/${uuid}`;
    
        console.log("[trash-auto-delete] Sending auto delete request to UI:", path);
    
        const socketio = this.services.get("socketio");
    
        await socketio.send(
            { room: userObj.id },    // send to that user's room
            "trash.auto_delete",     // event name
            {
                uuid,
                path,
            }
        );
    }
}

module.exports = { TrashAutoDeleteService };
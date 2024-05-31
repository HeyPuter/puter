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
const BaseService = require("../BaseService");
const { UserActorType, AppUnderUserActorType } = require("../auth/Actor");
const { DB_WRITE } = require("../database/consts");

class MonthlyUsageService extends BaseService {
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'usage');
    }

    async increment (actor, key, extra) {
        key = `${actor.uid}:${key}`;

        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        const maybe_app_id = actor.type.app?.id;

        if ( this.db.case({ sqlite: true, otherwise: false }) ) {
            return;
        }

        const vals =
                [
                    year, month, key, actor.type.user.id, maybe_app_id, JSON.stringify(extra),
                    ...this.db.case({ mysql: [JSON.stringify(extra)], otherwise: [] }),
                ]

        // UPSERT increment count
        try {
            await this.db.write(
                'INSERT INTO `service_usage_monthly` (`year`, `month`, `key`, `count`, `user_id`, `app_id`, `extra`) ' +
                'VALUES (?, ?, ?, 1, ?, ?, ?) ' +
                this.db.case({
                    mysql: 'ON DUPLICATE KEY UPDATE `count` = `count` + 1, `extra` = ?',
                    sqlite: ' ',
                    // sqlite: 'ON CONFLICT(`year`, `month`, `key`, `user_id`, `app_id`) ' +
                    //     'DO UPDATE SET `count` = `count` + 1 AND `extra` = ?',
                }),
                [
                    year, month, key, actor.type.user.id, maybe_app_id ?? null, JSON.stringify(extra),
                    ...this.db.case({ mysql: [JSON.stringify(extra)], otherwise: [] }),
                ]
            );
        } catch (e) {
            // if ( e.code !== 'SQLITE_ERROR' && e.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY' ) throw e;
            // The "ON CONFLICT" clause isn't currently working.
            await this.db.write(
                'UPDATE `service_usage_monthly` ' +
                'SET `count` = `count` + 1, `extra` = ? ' +
                'WHERE `year` = ? AND `month` = ? AND `key` = ? ' +
                'AND `user_id` = ? AND `app_id` = ?',
                [
                    JSON.stringify(extra),
                    year, month, key, actor.type.user.id, maybe_app_id,
                ]
            );

        }
    }

    async check (actor, specifiers) {
        if ( actor.type instanceof UserActorType ) {
            return await this._user_check(actor, specifiers);
        }

        if ( actor.type instanceof AppUnderUserActorType ) {
            return await this._app_under_user_check(actor, specifiers);
        }

    }

    async _user_check (actor, specifiers) {
        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        const rows = await this.db.read(
            'SELECT SUM(`count`) AS sum FROM `service_usage_monthly` ' +
            'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
            'AND JSON_CONTAINS(`extra`, ?)',
            [
                year, month, actor.type.user.id,
                JSON.stringify(specifiers),
            ]
        );

        return rows[0]?.sum || 0;
    }

    async _app_under_user_check (actor, specifiers) {
        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        const specifier_entries = Object.entries(specifiers);

        // SELECT count
        const rows = await this.db.read(
            'SELECT `count` FROM `service_usage_monthly` ' +
            'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
            'AND `app_id` = ? ' +
            'AND JSON_CONTAINS(`extra`, ?)',
            [
                year, month, actor.type.user.id,
                actor.type.app.id,
                specifiers,
            ]
        );

        return rows[0]?.count || 0;
    }
}

module.exports = {
    MonthlyUsageService,
};

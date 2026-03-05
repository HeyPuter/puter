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
const config = require('../../config');
const APIError = require('../../api/APIError.js');
const { DB_WRITE } = require('../../services/database/consts');
const { username_exists, change_username } = require('../../helpers');
const { Context } = require('../../util/context');

module.exports = {
    route: '/change-username',
    methods: ['POST'],
    handler: async (req, res, _next) => {
        const user = req.user;
        const new_username = req.body.new_username;

        if ( ! new_username ) {
            throw APIError.create('field_missing', null, { key: 'new_username' });
        }
        if ( typeof new_username !== 'string' ) {
            throw APIError.create('field_invalid', null, { key: 'new_username', expected: 'a string' });
        }
        if ( ! new_username.match(config.username_regex) ) {
            throw APIError.create('field_invalid', null, { key: 'new_username', expected: 'letters, numbers, underscore (_)' });
        }
        if ( new_username.length > config.username_max_length ) {
            throw APIError.create('field_too_long', null, { key: 'new_username', max_length: config.username_max_length });
        }
        if ( await username_exists(new_username) ) {
            throw APIError.create('username_already_in_use', null, { username: new_username });
        }

        const svc_edgeRateLimit = req.services.get('edge-rate-limit');
        if ( ! svc_edgeRateLimit.check('/user-protected/change-username') ) {
            return res.status(429).send('Too many requests.');
        }

        const db = Context.get('services').get('database').get(DB_WRITE, 'auth');
        const rows = await db.read(
            'SELECT COUNT(*) AS `count` FROM `user_update_audit` ' +
            `WHERE \`user_id\`=? AND \`reason\`=? AND ${
                db.case({
                    mysql: '`created_at` > DATE_SUB(NOW(), INTERVAL 1 MONTH)',
                    sqlite: "`created_at` > datetime('now', '-1 month')",
                })}`,
            [user.id, 'change_username'],
        );

        if ( rows[0].count >= (config.max_username_changes ?? 2) ) {
            throw APIError.create('too_many_username_changes');
        }

        await db.write(
            'INSERT INTO `user_update_audit` ' +
            '(`user_id`, `user_id_keep`, `old_username`, `new_username`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?)',
            [user.id, user.id, user.username, new_username, 'change_username'],
        );

        await change_username(user.id, new_username);

        res.json({});
    },
};

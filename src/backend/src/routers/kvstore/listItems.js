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
const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { DB_READ } = require("../../services/database/consts");

module.exports = eggspress('/listItems', {
    subdomain: 'api',
    auth: true,
    verified: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {

    let { app } = req.body;

    // Validation for `app`
    if ( ! app ) {
        throw APIError.create('field_missing', null, { key: 'app' });
    }

    const db = req.services.get('database').get(DB_READ, 'kv');
    let rows = await db.read(
        `SELECT kkey, value FROM kv WHERE user_id=? AND app=?`,
        [
            req.user.id,
            app,
        ]
    );

    rows = rows.map(row => ({
        key: row.kkey,
        value: row.value,
    }));

    return res.send(rows);
});

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
const { Eq } = require("../query/query");
const { BaseES } = require("./BaseES");

class NotificationES extends BaseES {
    static METHODS = {
        async create_predicate (id) {
            if ( id === 'unread' ) {
                return new Eq({
                    key: 'read',
                    value: 0,
                });
            }
            if ( id === 'read' ) {
                return new Eq({
                    key: 'read',
                    value: 1,
                });
            }
        },
        async read_transform (entity) {
            await entity.set('value', JSON.parse(await entity.get('value') ?? '{}'));
        }
    }
}

module.exports = { NotificationES };
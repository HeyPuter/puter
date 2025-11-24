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

const { DB_READ } = require('../../services/database/consts');
const { Context } = require('../../util/context');
const { NodeUIDSelector } = require('../node/selectors');
const { HLFilesystemOperation } = require('./definitions');

class HLNameSearch extends HLFilesystemOperation {
    async _run () {
        let { actor, term } = this.values;
        const services = Context.get('services');
        const svc_fs = services.get('filesystem');
        const db = services.get('database')
            .get(DB_READ, 'fs.namesearch');

        term = term.replace(/%/g, '');
        term = `%${ term }%`;

        // Only user actors can do this, because the permission
        // system would otherwise slow things down
        if ( ! actor.type.user ) return [];

        const results = await db.read('SELECT uuid FROM fsentries WHERE name LIKE ? AND ' +
            'user_id = ? LIMIT 50',
        [term, actor.type.user.id]);

        const uuids = results.map(v => v.uuid);

        const fsnodes = await Promise.all(uuids.map(async uuid => {
            return await svc_fs.node(new NodeUIDSelector(uuid));
        }));

        return Promise.all(fsnodes.map(async fsnode => {
            return await fsnode.getSafeEntry();
        }));
    }
}

module.exports = {
    HLNameSearch,
};

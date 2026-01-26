/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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
'use strict';
const { Context } = require('../../util/context.js');
const eggspress = require('../../api/eggspress.js');
const { DB_READ } = require('../../services/database/consts');
const config = require('../../config');

// -----------------------------------------------------------------------//
// POST /readdir-subdomains
// -----------------------------------------------------------------------//
module.exports = eggspress('/readdir-subdomains', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    json: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    let log; {
        const x = Context.get();
        log = x.get('services').get('log-service').create('readdir-subdomains', {
            concern: 'filesystem',
        });
        log.debug('readdir-subdomains: batch fetch subdomains');
    }

    const { directory_ids } = req.body;

    if ( !Array.isArray(directory_ids) || directory_ids.length === 0 ) {
        return res.status(400).send({
            code: 'invalid_request',
            message: 'directory_ids must be a non-empty array',
        });
    }

    const user = req.user;
    const db = Context.get().get('services').get('database').get(DB_READ, 'filesystem');

    // Note: directory_ids are actually UUIDs (not database IDs) because fsentry.id is set to uuid in getSafeEntry()
    // We need to convert UUIDs to database IDs first
    log.debug(`readdir-subdomains: received ${directory_ids.length} directory UUIDs:`, directory_ids);

    // Convert UUIDs to database IDs
    const uuidPlaceholders = directory_ids.map(() => '?').join(',');
    const fsentries = await db.read(`SELECT id, uuid FROM fsentries WHERE uuid IN (${uuidPlaceholders})`,
                    directory_ids);

    // Create maps: uuid -> db_id and db_id -> uuid
    const uuidToDbId = new Map();
    const dbIdToUuid = new Map();
    for ( const fsentry of fsentries ) {
        uuidToDbId.set(fsentry.uuid, fsentry.id);
        dbIdToUuid.set(fsentry.id, fsentry.uuid);
    }

    const dbIds = Array.from(uuidToDbId.values());
    log.debug(`readdir-subdomains: converted to ${dbIds.length} database IDs:`, dbIds);
    log.debug(`readdir-subdomains: user_id: ${user.id}`);

    if ( dbIds.length === 0 ) {
        return res.send(directory_ids.map(dirUuid => ({
            directory_id: dirUuid,
            subdomains: [],
            has_website: false,
        })));
    }

    // Build the query with placeholders using database IDs
    const placeholders = dbIds.map(() => '?').join(',');
    const rows = await db.read(`SELECT root_dir_id, subdomain, uuid
         FROM subdomains
         WHERE root_dir_id IN (${placeholders}) AND user_id = ?`,
    [...dbIds, user.id]);

    log.debug(`readdir-subdomains: found ${rows.length} subdomain rows`);

    // Group subdomains by database ID
    const subdomainsByDbId = {};

    for ( const row of rows ) {
        if ( ! subdomainsByDbId[row.root_dir_id] ) {
            subdomainsByDbId[row.root_dir_id] = [];
        }
        subdomainsByDbId[row.root_dir_id].push({
            subdomain: row.subdomain,
            address: `${config.protocol}://${row.subdomain}.puter.site`,
            uuid: row.uuid,
        });
    }

    // Build response: array of { directory_id, subdomains, has_website }
    // Map back to original UUIDs (directory_ids)
    const result = directory_ids.map(dirUuid => {
        const dbId = uuidToDbId.get(dirUuid);
        const subdomains = dbId ? (subdomainsByDbId[dbId] || []) : [];
        const has_website = subdomains.length > 0;

        log.debug(`readdir-subdomains: directory_id ${dirUuid} (db_id: ${dbId}) -> ${subdomains.length} subdomains, has_website: ${has_website}`);

        return {
            directory_id: dirUuid,
            subdomains: subdomains,
            has_website: has_website,
        };
    });

    log.debug(`readdir-subdomains: returning ${result.length} results`);
    res.send(result);
    return;
});

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
const eggspress = require('../../api/eggspress');
const { is_valid_uuid4, get_app } = require('../../helpers');
const express = require('express');
const { fuzz_number } = require('../../util/fuzz');
const { DB_READ } = require('../../services/database/consts');

const PREFIX_APP_UID = 'app-';

module.exports = eggspress('/query/app', {
    subdomain: 'api',
    auth: true,
    verified: true,
    fs: true,
    mw: [ express.json({ extended: true }) ],
    allowedMethods: ['POST'],
}, async (req, res, _next) => {
    const results = [];

    const db = req.services.get('database').get(DB_READ, 'apps');

    const svc_appInformation = req.services.get('app-information');

    const app_list = [...req.body];

    for ( let i = 0 ; i < app_list.length ; i++ ) {
        const P = 'collection:';
        if ( app_list[i].startsWith(P) ) {
            let [col_name, amount] = app_list[i].slice(P.length).split(':');
            if ( amount === undefined ) amount = 20;
            let uids = svc_appInformation.collections[col_name];
            uids = uids.slice(0, Math.min(uids.length, amount));
            app_list.splice(i, 1, ...uids);
        }
    }

    for ( let i = 0 ; i < app_list.length ; i++ ) {
        const P = 'tag:';
        if ( app_list[i].startsWith(P) ) {
            let [tag_name, amount] = app_list[i].slice(P.length).split(':');
            if ( amount === undefined ) amount = 20;
            let uids = svc_appInformation.tags[tag_name] ?? [];
            uids = uids.slice(0, Math.min(uids.length, amount));
            app_list.splice(i, 1, ...uids);
        }
    }

    for ( const app_selector_raw of app_list ) {
        const app_selector =
            app_selector_raw.startsWith(PREFIX_APP_UID) &&
            is_valid_uuid4(app_selector_raw.slice(PREFIX_APP_UID.length))
                ? { uid: app_selector_raw }
                : { name: app_selector_raw }
            ;

        const app = await get_app(app_selector);
        if ( ! app ) continue;

        // uuid, name, title, description, icon, created, filetype_associations, number of users

        // emit event for extra data gathering
        const extraDataEventObject = Object.fromEntries(app_list.map((appId) => [appId, {}]));
        await req.services.get('event').emit('apps.queried.extra', extraDataEventObject);

        // TODO: cache
        const associations = []; {
            const res_associations = await db.read('SELECT * FROM app_filetype_association WHERE app_id = ?',
                            [app.id]);
            for ( const row of res_associations ) {
                associations.push(row.type);
            }
        }

        const stats = await svc_appInformation.get_stats(app.uid);
        for ( const k in stats ) stats[k] = fuzz_number(stats[k]);

        delete stats.open_count;

        // TODO: imply from app model
        results.push({
            uuid: app.uid,
            name: app.name,
            title: app.title,
            // icon: app.icon,
            description: app.description,
            metadata: app.metadata,
            tags: app.tags ? app.tags.split(',') : [],
            created: app.timestamp,
            associations,
            ...stats,
            ...extraDataEventObject[app.uid],
        });
    }

    res.send(results);
});

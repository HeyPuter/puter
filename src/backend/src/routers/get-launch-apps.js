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
"use strict"
const { get_app } = require('../helpers.js');
const { DB_READ } = require('../services/database/consts.js');

const iconify_apps = async (context, { apps, size }) => {
    return await Promise.all(apps.map(async app => {
        const svc_appIcon = context.services.get('app-icon');
        const icon_result = await svc_appIcon.get_icon_stream({
            app_icon: app.icon,
            app_uid: app.uid ?? app.uuid,
            size: size,
        });

        app.icon = await icon_result.get_data_url();
        return app;
    }));
}

// -----------------------------------------------------------------------//
// GET /get-launch-apps
// -----------------------------------------------------------------------//
module.exports = async (req, res) => {
    let result = {};

    // Verify query params
    if ( req.query.icon_size ) {
        const ALLOWED_SIZES = ['16', '32', '64', '128', '256', '512'];
    
        if ( ! ALLOWED_SIZES.includes(req.query.icon_size) ) {
            res.status(400).send({ error: 'Invalid icon_size' });
        }
    }

    // -----------------------------------------------------------------------//
    // Recommended apps
    // -----------------------------------------------------------------------//
    const svc_recommendedApps = req.services.get('recommended-apps');
    result.recommended = await svc_recommendedApps.get_recommended_apps({
        icon_size: req.query.icon_size
    });

    // -----------------------------------------------------------------------//
    // Recent apps
    // -----------------------------------------------------------------------//
    let apps = [];

    const db = req.services.get('database').get(DB_READ, 'apps');

    // First try the cache to see if we have recent apps
    apps = kv.get('app_opens:user:' + req.user.id);

    // If cache is empty, query the db and update the cache
    if(!apps || !Array.isArray(apps) || apps.length === 0){
        apps = await db.read(
            'SELECT DISTINCT app_uid FROM app_opens WHERE user_id = ? GROUP BY app_uid ORDER BY MAX(_id) DESC LIMIT 10',
            [req.user.id]);
        // Update cache with the results from the db (if any results were returned)
        if(apps && Array.isArray(apps) && apps.length > 0) {
            kv.set('app_opens:user:' + req.user.id, apps);
        }
    }

    // prepare each app for returning to user by only returning the necessary fields
    // and adding them to the retobj array
    result.recent = [];
    console.log('\x1B[36;1m -------- RECENT APPS -------- \x1B[0m', apps);
    for ( const { app_uid: uid } of apps ) {
        console.log('\x1B[36;1m -------- UID -------- \x1B[0m', uid);
        const app = await get_app({ uid });
        if ( ! app ) continue

        result.recent.push({
            uuid: app.uid,
            name: app.name,
            title: app.title,
            icon: app.icon,
            godmode: app.godmode,
            maximize_on_start: app.maximize_on_start,
            index_url: app.index_url,
        });
    }

    // Iconify apps
    if ( req.query.icon_size ) {
        result.recent = await iconify_apps({ services: req.services }, {
            apps: result.recent,
            size: req.query.icon_size,
        });
    }

    return res.send(result);
};

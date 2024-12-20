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
"use strict"
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.js');
const { get_app } = require('../helpers.js');
const { DB_READ } = require('../services/database/consts.js');

// -----------------------------------------------------------------------//
// GET /get-launch-apps
// -----------------------------------------------------------------------//
module.exports = async (req, res) => {
    let result = {};

    // -----------------------------------------------------------------------//
    // Recommended apps
    // -----------------------------------------------------------------------//
    result.recommended = kv.get('global:recommended-apps');
    if ( ! result.recommended ) {
        let app_names = new Set([
            'app-center',
            'dev-center',
            'editor',
            'code',
            'terminal',
            'draw',
            'silex',
            'camera',
            'recorder',
            'shell-shockers-outpan',
            'krunker',
            'slash-frvr',
            'viewer',
            'solitaire-frvr',
            'markus',
            'player',
            'pdf',
            'polotno',
            'basketball-frvr',
            'gold-digger-frvr',
            'plushie-connect',
            'hex-frvr',
            'spider-solitaire',
        ]);

        // Prepare each app for returning to user by only returning the necessary fields
        // and adding them to the retobj array
        result.recommended = [];
        for ( const name of app_names ) {
            const app = await get_app({ name });
            if ( ! app ) continue;

            result.recommended.push({
                uuid: app.uid,
                name: app.name,
                title: app.title,
                icon: app.icon,
                godmode: app.godmode,
                maximize_on_start: app.maximize_on_start,
                index_url: app.index_url,
            });
        }

        kv.set('global:recommended-apps', result.recommended);
    }

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

    return res.send(result);
};

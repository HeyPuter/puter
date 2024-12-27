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
const { stream_to_buffer } = require('../util/streamutil.js');

const get_apps = async ({ specifiers }) => {
    return await Promise.all(specifiers.map(async (specifier) => {
        return await get_app(specifier);
    }));
};

const iconify_apps = async (context, { apps, size }) => {
    return await Promise.all(apps.map(async app => {
        const svc_appIcon = context.services.get('app-icon');
        const icon_result = await svc_appIcon.get_icon_stream({
            app_icon: app.icon,
            app_uid: app.uid ?? app.uuid,
            size: size,
        });

        if ( icon_result.data_url ) {
            app.icon = icon_result.data_url;
            return app;
        }

        try {
            const buffer = await stream_to_buffer(icon_result.stream);
            const resp_data_url = `data:${icon_result.mime};base64,${buffer.toString('base64')}`;
            
            app.icon = resp_data_url;
        } catch (e) {
            const svc_error = context.services.get('error');
            svc_error.report('get-launch-apps:icon-stream', {
                source: e,
            });
        }
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
    const recommended_cache_key = 'global:recommended-apps' + (
        req.query.icon_size ? `:icon-size:${req.query.icon_size}` : ''
    );
    result.recommended = kv.get(recommended_cache_key);
    if ( ! result.recommended ) {
        let app_names = new Set([
            'app-center',
            'dev-center',
            'editor',
            'code',
            'camera',
            'recorder',
            'shell-shockers-outpan',
            'krunker',
            'slash-frvr',
            'viewer',
            'solitaire-frvr',
            'terminal',
            'tiles-beat',
            'draw',
            'silex',
            'markus',
            'puterjs-playground',
            'player',
            'pdf',
            'polotno',
            'basketball-frvr',
            'gold-digger-frvr',
            'plushie-connect',
            'hex-frvr',
            'spider-solitaire',
            'danger-cross',
            'doodle-jump-extra',
            'endless-lake',
            'sword-and-jewel',
            'reversi-2',
            'in-orbit',
            'bowling-king',
            'photopea',
            'calc-hklocykcpts',
            'virtu-piano',
            'battleship-war',
            'turbo-racing',
            'guns-and-bottles',
            'tronix',
            'jewel-classic',
        ]);

        // Prepare each app for returning to user by only returning the necessary fields
        // and adding them to the retobj array
        result.recommended = (await get_apps({
            specifiers: Array.from(app_names).map(name => ({ name }))
        })).filter(app => !! app).map(app => {
            return {
                uuid: app.uid,
                name: app.name,
                title: app.title,
                icon: app.icon,
                godmode: app.godmode,
                maximize_on_start: app.maximize_on_start,
                index_url: app.index_url,
            };
        });

        // Iconify apps
        if ( req.query.icon_size ) {
            result.recommended = await iconify_apps({ services: req.services }, {
                apps: result.recommended,
                size: req.query.icon_size,
            });
        }

        kv.set(recommended_cache_key, result.recommended);
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

    // Iconify apps
    if ( req.query.icon_size ) {
        result.recent = await iconify_apps({ services: req.services }, {
            apps: result.recent,
            size: req.query.icon_size,
        });
    }

    return res.send(result);
};

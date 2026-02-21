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

import { redisClient } from '../../clients/redis/redisSingleton.js';
import { get_apps } from '../../helpers.js';
import BaseService from '../../services/BaseService.js';
import { RecommendedAppsRedisCacheSpace } from './RecommendedAppsRedisCacheSpace.js';

export default class RecommendedAppsService extends BaseService {
    static APP_NAMES = [
        'app-center',
        'dev-center',
        'editor',
        'code',
        'camera',
        'recorder',
        'shell-shockers-outpan',
        'krunker',
        'slash-frvr',
        'judge0',
        'viewer',
        'solitaire-frvr',
        'tiles-beat',
        'silex',
        'markus',
        'puterjs-playground',
        'player',
        'grist',
        'pdf',
        'photopea',
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
        'calc-hklocykcpts',
        'virtu-piano',
        'battleship-war',
        'turbo-racing',
        'guns-and-bottles',
        'tronix',
        'jewel-classic',
    ];

    _construct () {
        this.app_names = new Set(RecommendedAppsService.APP_NAMES);
    }

    '__on_boot.consolidation' () {
        const svc_appIcon = this.services.get('app-icon');
        const svc_event = this.services.get('event');
        svc_event.on('apps.invalidate', async (_, { app }) => {
            const sizes = svc_appIcon.getSizes();

            // If it's a single-app invalidation, only invalidate if the
            // app is in the list of recommended apps
            if ( app ) {
                const name = app.name;
                if ( ! this.app_names.has(name) ) return;
            }

            const deletions = [redisClient.del(RecommendedAppsRedisCacheSpace.key())];
            for ( const size of sizes ) {
                const key = RecommendedAppsRedisCacheSpace.key({ iconSize: size });
                deletions.push(redisClient.del(key));
            }
            Promise.all(deletions);
        });
    }

    async get_recommended_apps ({ icon_size: iconSize }) {
        const recommendedCacheKey = RecommendedAppsRedisCacheSpace.key({ iconSize });

        const cachedRecommended = await redisClient.get(recommendedCacheKey);
        if ( cachedRecommended ) {
            try {
                return JSON.parse(cachedRecommended);
            } catch (e) {
                // no op cache is in an invalid state
            }
        }

        // Prepare each app for returning to user by only returning the necessary fields
        // and adding them to the retobj array
        let recommended = (await get_apps(Array.from(this.app_names).map(name => ({ name })))).filter(app => !!app).map(app => {
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

        const svc_appIcon = this.services.get('app-icon');

        // Iconify apps
        if ( iconSize ) {
            recommended = await svc_appIcon.iconifyApps({
                apps: recommended,
                size: iconSize,
            });
        }

        redisClient.set(recommendedCacheKey, JSON.stringify(recommended));

        return recommended;
    }
}

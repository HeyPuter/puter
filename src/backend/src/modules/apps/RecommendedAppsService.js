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

const { get_app } = require("../../helpers");
const BaseService = require("../../services/BaseService");

const get_apps = async ({ specifiers }) => {
    return await Promise.all(specifiers.map(async (specifier) => {
        return await get_app(specifier);
    }));
};

class RecommendedAppsService extends BaseService {
    static APP_NAMES = [
        'app-center',
        'dev-center',
        'editor',
        'code',
        'camera',
        'recorder',
        'shell-shockers-outpan',
        'the-browser',
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
        'photopea',
        'polotno',
        'basketball-frvr',
        'gold-digger-frvr',
        'plushie-connect',
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
    
    ['__on_boot.consolidation'] () {
        const svc_appIcon = this.services.get('app-icon');
        const svc_event = this.services.get('event');
        svc_event.on('apps.invalidate', (_, { app }) => {
            const sizes = svc_appIcon.get_sizes();
            
            this.log.noticeme('Invalidating recommended apps', { app, sizes });

            // If it's a single-app invalidation, only invalidate if the
            // app is in the list of recommended apps
            if ( app ) {
                const name = app.name;
                if ( ! this.app_names.has(name) ) return;
            }

            kv.del('global:recommended-apps');
            for ( const size of sizes ) {
                const key = `global:recommended-apps:icon-size:${size}`;
                kv.del(key);
            }
        });
    }

    async get_recommended_apps ({ icon_size }) {
        const recommended_cache_key = 'global:recommended-apps' + (
            icon_size ? `:icon-size:${icon_size}` : ''
        );

        let recommended = kv.get(recommended_cache_key);
        if ( recommended ) return recommended;

        // Prepare each app for returning to user by only returning the necessary fields
        // and adding them to the retobj array
        recommended = (await get_apps({
            specifiers: Array.from(this.app_names).map(name => ({ name }))
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
        
        const svc_appIcon = this.services.get('app-icon');

        // Iconify apps
        if ( icon_size ) {
            recommended = await svc_appIcon.iconify_apps({
                apps: recommended,
                size: icon_size,
            });
        }

        kv.set(recommended_cache_key, recommended);
        
        return recommended;
    }
}

module.exports = RecommendedAppsService;

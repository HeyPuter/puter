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

import { get_apps } from '../../helpers.js';
import { BaseService } from '../../services/BaseService.js';

export default class RecommendedAppsService extends BaseService {
    appNames = new Set([
        'app-center',
        'dev-center',
        'editor',
        'code',
        'camera',
        'music-player',
        'recorder',
        'memos',
        'word-processor',
        'spreadsheet',
        'presentation',
        'pdf-editor',
        'basketball-tap',
        'blockup',
        'pretty-tiles',
        'galaxy-troops',
        'blend-fruits',
        'traffic-tap-puzzle',
    ]);

    async get_recommended_apps ({ icon_size: iconSize }) {

        // Prepare each app for returning to user by only returning the necessary fields
        // and adding them to the retobj array
        let recommended = (await get_apps(Array.from(this.appNames).map(name => ({ name })))).filter(app => !!app).map(app => {
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

        return recommended;
    }
}

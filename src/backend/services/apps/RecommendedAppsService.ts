/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import type { AppIconHostConfig } from '../../util/appIcon.js';
import { getAppIconCdnUrl, getAppIconUrl } from '../../util/appIcon.js';
import { PuterService } from '../types.js';

/**
 * Hardcoded list of recommended apps shown on the desktop launch grid. Resolved
 * at call time against the apps table.
 */
const RECOMMENDED_APP_NAMES = [
    'app-center',
    'builder',
    'editor',
    'camera',
    'recorder',
    'calculator',
    'contacts',
    'calendar',
    'meetings',
    'blockarena',
    'music-player',
    'word-processor',
    'spreadsheet',
    'presentation',
    'pdf-editor',
    'diagram',
    'memos',
    'audio-editor',
    'browser',
    'ai-image-project',
    'chess',
    'checkers',
    'backgammon',
    'klondike',
    'sudoku',
    'blockup',
    'basketball-tap',
    'dev-center',
];

export class RecommendedAppsService extends PuterService {
    async getRecommendedApps(): Promise<Array<Record<string, unknown>>> {
        const apiBaseUrl = this.config.api_base_url as string | undefined;
        const results: Array<Record<string, unknown>> = [];
        for (const name of RECOMMENDED_APP_NAMES) {
            const app = await this.stores.app.getByName(name);
            if (app) results.push(toAppSummary(app, apiBaseUrl, this.config));
        }
        return results;
    }
}

function toAppSummary(
    app: Record<string, unknown>,
    apiBaseUrl: string | undefined,
    config: AppIconHostConfig,
): Record<string, unknown> {
    return {
        uuid: app.uid,
        name: app.name,
        title: app.title,
        icon: getAppIconUrl(app, { apiBaseUrl }) ?? app.icon ?? null,
        // Direct subdomain URL for the client to try before `icon`.
        iconCdnUrl: getAppIconCdnUrl(app, config),
        godmode: Boolean(app.godmode),
        maximize_on_start: Boolean(app.maximize_on_start),
        index_url: app.index_url,
        // Launched straight from this summary as `app_obj` — see
        // SuggestedAppsService.toAppSummary; the drawer's feedback control
        // renders off this flag.
        feedback_enabled: Boolean(app.feedback_enabled),
        // An app with no owner isn't owned by a Puter user — it's an
        // "external" (origin-bootstrapped) app.
        external: app.owner_user_id == null || app.owner_user_id === '',
    };
}

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

import { toAppSummary } from '../../util/appView.js';
import { PuterService } from '../types.js';

/**
 * Hardcoded list of recommended apps shown on the desktop launch grid. Resolved
 * at call time against the apps table.
 */
export const RECOMMENDED_APP_NAMES = [
    'builder',
    'contacts',
    'calendar',
    'meetings',
    'teamchat',
    'email',
    'whiteboard',
    'spreadsheet',
    'word-processor',
    'presentation',
    'pdf-editor',
    'terminal',
    'dev-center',
    'cap-table',
    'invoices',
    'crm',
    'signatures',
    'projects',
    'point-of-sale',
    'inventory',
    'hiring',
    'time-tracking',
    'shift-planner',
    'equipment',
    'chess',
    'checkers',
    'backgammon',
    'sudoku',
    'klondike',
];

export class RecommendedAppsService extends PuterService {
    async getRecommendedApps(): Promise<Array<Record<string, unknown>>> {
        const event = { appNames: [...RECOMMENDED_APP_NAMES] };
        await this.clients.event.emitAndWait('app.recommended', event, {});

        const apiBaseUrl = this.config.api_base_url as string | undefined;
        const appsByName = await this.stores.app.getByNames(event.appNames);
        return event.appNames.flatMap((name) => {
            const app = appsByName.get(name);
            return app
                ? [toAppSummary(app, { apiBaseUrl, config: this.config })]
                : [];
        });
    }
}

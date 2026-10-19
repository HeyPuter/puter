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

import { describe, it, expect } from 'vitest';
import { filterLaunchableApps } from './launchAppsList.js';

const app = (name, extra = {}) => ({ name, ...extra });

describe('filterLaunchableApps', () => {
    it('tolerates a missing list', () => {
        expect(filterLaunchableApps(null)).toEqual([]);
        expect(filterLaunchableApps(undefined)).toEqual([]);
    });

    it('keeps apps with no availability marker', () => {
        const apps = [app('explorer'), app('dev-center')];
        expect(filterLaunchableApps(apps)).toEqual(apps);
    });

    it('keeps apps the viewer is allowed to open', () => {
        const apps = [app('chess', { privateAccess: { hasAccess: true } })];
        expect(filterLaunchableApps(apps)).toEqual(apps);
    });

    it('drops an app the backend marks unlaunchable', () => {
        const apps = [
            app('kept'),
            app('reclaimed', {
                index_url: null,
                privateAccess: { hasAccess: false, reason: 'hosted-backing-unavailable' },
            }),
        ];
        expect(filterLaunchableApps(apps)).toEqual([app('kept')]);
    });

    it('preserves order of the entries it keeps', () => {
        const apps = [
            app('a'),
            app('gone', { privateAccess: { hasAccess: false } }),
            app('b'),
        ];
        expect(filterLaunchableApps(apps).map((a) => a.name)).toEqual(['a', 'b']);
    });

    it('skips nullish entries', () => {
        expect(filterLaunchableApps([null, app('a'), undefined])).toEqual([app('a')]);
    });
});

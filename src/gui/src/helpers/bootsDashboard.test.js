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
import { bootsDashboard } from './bootsDashboard.js';

const boots = (url, { inIframe = false, embeddedInPopup = false } = {}) => {
    const { pathname, searchParams } = new URL(url, 'https://puter.com');
    return bootsDashboard({ pathname, searchParams, inIframe, embeddedInPopup });
};

describe('bootsDashboard', () => {
    it('boots the dashboard at the root, its alias, and app landings', () => {
        expect(boots('/')).toBe(true);
        expect(boots('/dashboard')).toBe(true);
        expect(boots('/dashboard/')).toBe(true);
        expect(boots('/app/editor')).toBe(true);
    });

    it('boots the desktop at /desktop', () => {
        expect(boots('/desktop')).toBe(false);
        expect(boots('/desktop/app/editor')).toBe(false);
    });

    it('boots the desktop for flows only the desktop handles', () => {
        expect(boots('/?app=editor')).toBe(false);
        expect(boots('/?puter.fullpage=true')).toBe(false);
        expect(boots('/', { inIframe: true })).toBe(false);
        expect(boots('/', { embeddedInPopup: true })).toBe(false);
    });

    it('keeps /dashboard on the dashboard even inside an iframe', () => {
        expect(boots('/dashboard', { inIframe: true })).toBe(true);
    });

    it('boots the dashboard for a share link or a download link', () => {
        expect(boots('/?shared=%2Fann%2Fuid%2Fnotes.txt')).toBe(true);
        expect(boots('/?download=https%3A%2F%2Fexample.com%2Ffile.zip')).toBe(true);
    });
});

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

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { startedInPuterSignIn } from './oidcLoginReturn.js';

describe('startedInPuterSignIn', () => {
    const config = {
        origin: 'https://example.test',
        domain: 'example.test',
        api_base_url: 'https://api.example.test',
        static_hosting_domain: 'site.example.test',
    };
    const req = (site?: string) =>
        ({
            headers: site ? { 'sec-fetch-site': site } : {},
        }) as unknown as Request;

    it.each([
        // Puter's own sign-in popup.
        ['same-origin', 'https://anything.test', true],
        // Its frame on a first-party page, which opens the popup from there.
        ['same-site', 'https://notes.example.test', true],
        ['same-site', 'https://someone.site.example.test', false],
        ['same-site', 'https://api.example.test', false],
        ['same-site', 'https://a.notes.example.test', false],
        ['same-site', null, false],
        // A page that opened the start route itself.
        ['cross-site', 'https://evil.test', false],
        ['none', 'https://evil.test', false],
        [undefined, 'https://evil.test', false],
    ])('a %s start for opener %s is %s', (site, opener, expected) => {
        expect(startedInPuterSignIn(req(site), opener, config)).toBe(expected);
    });
});

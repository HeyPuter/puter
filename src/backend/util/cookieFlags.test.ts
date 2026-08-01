/**
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

import { describe, expect, it } from 'vitest';
import type { IConfig } from '../types';
import { sessionCookieFlags } from './cookieFlags.ts';

const https = { protocol: 'https' } as IConfig;
const http = { protocol: 'http' } as IConfig;

describe('sessionCookieFlags', () => {
    it('uses the cross-site pair on HTTPS by default', () => {
        expect(sessionCookieFlags(https)).toEqual({
            sameSite: 'none',
            secure: true,
        });
    });

    it('stays lax on HTTPS when the cookie never crosses origins', () => {
        expect(sessionCookieFlags(https, { crossSite: false })).toEqual({
            sameSite: 'lax',
            secure: true,
        });
    });

    it('drops secure + none over plain HTTP so the cookie is not silently discarded', () => {
        expect(sessionCookieFlags(http)).toEqual({
            sameSite: 'lax',
            secure: false,
        });
        expect(sessionCookieFlags(http, { crossSite: true })).toEqual({
            sameSite: 'lax',
            secure: false,
        });
    });

    it('treats an unset protocol as non-HTTPS', () => {
        expect(sessionCookieFlags({} as IConfig)).toEqual({
            sameSite: 'lax',
            secure: false,
        });
    });
});

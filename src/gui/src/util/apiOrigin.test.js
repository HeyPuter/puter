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
import { isLoopbackOrigin, resolveAPIOrigin } from './apiOrigin.js';

const CONFIGURED = 'https://api.puter.com';
const EVIL = 'https://attacker.example';

describe('isLoopbackOrigin', () => {
    it('accepts the hosts a local Puter is served from', () => {
        for ( const origin of [
            'http://localhost:4100',
            'http://puter.localhost:4100',
            'http://api.puter.localhost:4100',
            'http://127.0.0.1:4100',
            'http://127.10.0.2',
            'http://[::1]:4100',
        ] ) {
            expect(isLoopbackOrigin(origin), origin).toBe(true);
        }
    });

    it('rejects everything else, including lookalikes', () => {
        for ( const origin of [
            'https://puter.com',
            'https://myputer.example',
            'https://localhost.attacker.example',
            'https://notlocalhost',
            'https://127.0.0.1.attacker.example',
            'not a url',
            undefined,
        ] ) {
            expect(isLoopbackOrigin(origin), String(origin)).toBe(false);
        }
    });
});

describe('resolveAPIOrigin', () => {
    it('ignores a URL-supplied origin on a hosted deployment', () => {
        expect(resolveAPIOrigin({
            configuredOrigin: CONFIGURED,
            guiOrigin: 'https://puter.com',
            urlOrigin: EVIL,
        })).toBe(CONFIGURED);
    });

    it('ignores a stored origin on a hosted deployment', () => {
        expect(resolveAPIOrigin({
            configuredOrigin: CONFIGURED,
            guiOrigin: 'https://puter.com',
            storedOrigin: EVIL,
        })).toBe(CONFIGURED);
    });

    it('ignores both on a self-hosted deployment', () => {
        expect(resolveAPIOrigin({
            configuredOrigin: 'https://api.myputer.example',
            guiOrigin: 'https://myputer.example',
            urlOrigin: EVIL,
            storedOrigin: EVIL,
        })).toBe('https://api.myputer.example');
    });

    it('honors a URL-supplied origin on a local Puter', () => {
        expect(resolveAPIOrigin({
            configuredOrigin: 'http://api.puter.localhost:4100',
            guiOrigin: 'http://puter.localhost:4100',
            urlOrigin: CONFIGURED,
        })).toBe(CONFIGURED);
    });

    it('falls back to a stored origin on a local Puter, URL winning', () => {
        const local = {
            configuredOrigin: 'http://api.puter.localhost:4100',
            guiOrigin: 'http://puter.localhost:4100',
        };
        expect(resolveAPIOrigin({ ...local, storedOrigin: CONFIGURED }))
            .toBe(CONFIGURED);
        expect(resolveAPIOrigin({ ...local, urlOrigin: CONFIGURED, storedOrigin: EVIL }))
            .toBe(CONFIGURED);
    });

    it('falls back to the configured origin when nothing is supplied', () => {
        expect(resolveAPIOrigin({
            configuredOrigin: CONFIGURED,
            guiOrigin: 'http://puter.localhost:4100',
            urlOrigin: null,
            storedOrigin: null,
        })).toBe(CONFIGURED);
    });
});

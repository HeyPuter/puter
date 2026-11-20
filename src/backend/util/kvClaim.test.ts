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

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import { claimOnce } from './kvClaim.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});
afterAll(async () => {
    await server?.shutdown();
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('claimOnce', () => {
    it('grants one of many concurrent claims, and again once it expires', async () => {
        const key = `claim-test:${uuidv4()}`;
        const kv = server.stores.kv;
        const results = await Promise.all(
            Array.from({ length: 5 }, () => claimOnce(kv, key, 60)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 61_000);
        expect(await claimOnce(kv, key, 60)).toBe(true);
    });

    it('refuses when the store fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const kv = server.stores.kv;
        vi.spyOn(kv, 'set').mockRejectedValue(new Error('kv down'));
        expect(await claimOnce(kv, `claim-test:${uuidv4()}`, 60)).toBe(false);
    });
});

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
import { holdsPermissions } from './holdsPermissions.js';

const EMAIL = 'user:u-1:email:read';
const APPS = 'apps-of-user:u-1:read';

// Minimal fetch double: records calls and answers with what is held.
const makeFetch = ({ held = {}, ok = true, throws = false } = {}) => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        calls.push({ url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) });
        if ( throws ) throw new Error('network down');
        return {
            ok,
            status: ok ? 200 : 500,
            json: async () => ({ permissions: held }),
        };
    };
    return { fetchImpl, calls };
};

const deps = (fetchImpl) => ({ fetchImpl, apiOrigin: 'https://api.test' });

describe('holdsPermissions', () => {
    it('reports held only when every permission is held', async () => {
        const both = makeFetch({ held: { [EMAIL]: true, [APPS]: true } });
        await expect(holdsPermissions([EMAIL, APPS], 'app-token', deps(both.fetchImpl)))
            .resolves.toBe(true);

        const partial = makeFetch({ held: { [EMAIL]: true, [APPS]: false } });
        await expect(holdsPermissions([EMAIL, APPS], 'app-token', deps(partial.fetchImpl)))
            .resolves.toBe(false);
    });

    it('asks as the app whose access is in question, deduped', async () => {
        const { fetchImpl, calls } = makeFetch({ held: { [EMAIL]: true } });

        await holdsPermissions([EMAIL, EMAIL], 'app-token', deps(fetchImpl));

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.test/auth/check-permissions');
        expect(calls[0].headers.Authorization).toBe('Bearer app-token');
        expect(calls[0].body).toEqual({ permissions: [EMAIL] });
    });

    // A check that couldn't be made is not an answer: the caller prompts.
    it('reports not held when the read fails', async () => {
        const failed = makeFetch({ ok: false });
        await expect(holdsPermissions([EMAIL], 'app-token', deps(failed.fetchImpl)))
            .resolves.toBe(false);

        const broken = makeFetch({ throws: true });
        await expect(holdsPermissions([EMAIL], 'app-token', deps(broken.fetchImpl)))
            .resolves.toBe(false);
    });

    // The prompt waits behind this check.
    it('gives up on a read that outlasts its timeout', async () => {
        const calls = [];
        const fetchImpl = (url, opts = {}) => {
            calls.push(opts.signal);
            return new Promise((_resolve, reject) => {
                opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            });
        };

        await expect(holdsPermissions([EMAIL], 'app-token', {
            fetchImpl,
            apiOrigin: 'https://api.test',
            timeoutMs: 5,
        })).resolves.toBe(false);
        // Aborted rather than left running behind the answer.
        expect(calls[0]?.aborted).toBe(true);
    });

    it('does not ask at all without a token or a permission', async () => {
        const { fetchImpl, calls } = makeFetch({ held: { [EMAIL]: true } });

        await expect(holdsPermissions([EMAIL], '', deps(fetchImpl))).resolves.toBe(false);
        await expect(holdsPermissions([], 'app-token', deps(fetchImpl))).resolves.toBe(false);
        await expect(holdsPermissions(null, 'app-token', deps(fetchImpl))).resolves.toBe(false);

        expect(calls).toHaveLength(0);
    });
});

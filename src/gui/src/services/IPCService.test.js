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

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// `definitions.js` reaches for the class registry the GUI bundle installs in
// init_sync.js, so stub it before importing anything from that graph.
globalThis.def = globalThis.def ?? ((cls) => cls);
globalThis.use = globalThis.use ?? (() => ({}));

let IPCService;
let uuidCounter = 0;

beforeAll(async () => {
    ({ IPCService } = await import('./IPCService.js'));
});

const makeService = async () => {
    const svc = new IPCService();
    await svc.init({ services: { get: () => ({}) } });
    return svc;
};

describe('IPCService connections', () => {
    beforeEach(() => {
        uuidCounter = 0;
        globalThis.window = globalThis.window ?? {};
        window.uuidv4 = () => `uuid-${++uuidCounter}`;
        window.ipc_handlers = {};
    });

    afterEach(() => {
        delete Object.prototype.object;
    });

    it('round-trips a registered connection by uuid', async () => {
        const svc = await makeService();
        const { forward, backward } = svc.add_connection({
            source: 'a',
            target: 'b',
        });
        expect(svc.get_connection(forward.uuid).target).toBe('b');
        expect(svc.get_connection(backward.uuid).target).toBe('a');
    });

    it('caches the connection object per uuid', async () => {
        const svc = await makeService();
        const { forward } = svc.add_connection({ source: 'a', target: 'b' });
        expect(svc.get_connection(forward.uuid)).toBe(
            svc.get_connection(forward.uuid),
        );
    });

    // The uuid comes from an app's `messageToApp` payload, so a prototype
    // member name must not look like a live connection — nor become one.
    it.each(['__proto__', 'constructor', 'toString'])(
        'treats `%s` as an unknown connection',
        async (uuid) => {
            const svc = await makeService();
            svc.add_connection({ source: 'a', target: 'b' });
            expect(svc.get_connection(uuid)).toBeUndefined();
            expect({}.object).toBeUndefined();
        },
    );

    it('returns undefined for an unknown uuid', async () => {
        const svc = await makeService();
        expect(svc.get_connection('nope')).toBeUndefined();
    });
});

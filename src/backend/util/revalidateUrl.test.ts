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
import type { EventListener } from '../clients/event/types.js';
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import type { IConfig } from '../types.js';
import { resolveRevalidateUrl } from './revalidateUrl.js';

const ORIGIN = 'https://puter.test';

let server: PuterServer;
const listeners: EventListener<'auth.reauth.options'>[] = [];

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    for (const listener of listeners.splice(0)) {
        server.clients.event.off('auth.reauth.options', listener);
    }
});

const listen = (listener: EventListener<'auth.reauth.options'>) => {
    listeners.push(listener);
    server.clients.event.on('auth.reauth.options', listener);
};

const user = { id: 41, uuid: uuidv4() };

const deps = (linkedProvider: () => Promise<string | null>) => ({
    config: { origin: `${ORIGIN}/` } as IConfig,
    event: server.clients.event,
    oidc: { getLinkedProviderForUser: linkedProvider },
});

describe('resolveRevalidateUrl', () => {
    it("uses a listener's URL without reading the core OIDC link", async () => {
        const seen: unknown[] = [];
        listen((_key, data) => {
            seen.push({ ...data });
            data.revalidateUrl = `${ORIGIN}/auth/sso/google/start?flow=revalidate`;
        });
        const linkedProvider = vi.fn(async () => 'google');

        const url = await resolveRevalidateUrl(user, deps(linkedProvider));

        expect(url).toBe(`${ORIGIN}/auth/sso/google/start?flow=revalidate`);
        expect(seen).toEqual([
            { userId: user.id, userUuid: user.uuid, revalidateUrl: null },
        ]);
        expect(linkedProvider).not.toHaveBeenCalled();
    });

    it('builds the core OIDC URL when no listener supplies one', async () => {
        listen(() => {});

        const url = await resolveRevalidateUrl(
            user,
            deps(async () => 'google'),
        );

        expect(url).toBe(
            `${ORIGIN}/auth/oidc/google/start?flow=revalidate&user_uuid=${user.uuid}`,
        );
    });

    it('builds the core OIDC URL when the listener throws', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        listen(() => {
            throw new Error('listener down');
        });

        const url = await resolveRevalidateUrl(
            user,
            deps(async () => 'apple'),
        );

        expect(url).toContain('/auth/oidc/apple/start?flow=revalidate');
        error.mockRestore();
    });

    it('returns null for an account with no provider link', async () => {
        expect(
            await resolveRevalidateUrl(
                user,
                deps(async () => null),
            ),
        ).toBeNull();
    });

    it('returns null when the provider lookup fails', async () => {
        expect(
            await resolveRevalidateUrl(
                user,
                deps(async () => {
                    throw new Error('oidc down');
                }),
            ),
        ).toBeNull();
    });
});

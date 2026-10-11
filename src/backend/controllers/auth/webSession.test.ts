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

import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configContainer } from '../../exports.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { startWebSession } from './webSession.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

describe('startWebSession', () => {
    it('records the request on the session, sets the HTTP-only cookie and returns a GUI token', async () => {
        const username = `ws_${Math.random().toString(36).slice(2, 10)}`;
        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });
        const cookies: Array<{ name: string; value: string; opts: unknown }> =
            [];
        const res = {
            cookie: (name: string, value: string, opts: unknown) => {
                cookies.push({ name, value, opts });
            },
        } as unknown as Response;
        const req = {
            ip: '192.0.2.10',
            headers: { 'user-agent': 'ws-agent', origin: 'https://gui.test' },
        } as unknown as Request;
        const config = configContainer as IConfig;

        const guiToken = await startWebSession(req, res, user, {
            config,
            auth: server.services.auth,
        });

        expect(typeof guiToken).toBe('string');
        expect(cookies).toHaveLength(1);
        expect(cookies[0]!.name).toBe(config.cookie_name ?? 'puter_token');
        expect(cookies[0]!.value).not.toBe(guiToken);
        expect(cookies[0]!.opts).toMatchObject({ httpOnly: true });

        const sessions = (await server.stores.session.getByUserId(
            user.id,
        )) as Array<Record<string, unknown>>;
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            kind: 'web',
            last_ip: '192.0.2.10',
            last_user_agent: 'ws-agent',
        });
    });
});

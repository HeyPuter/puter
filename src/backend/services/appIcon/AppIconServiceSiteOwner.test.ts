/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPuterSiteMiddleware } from '../../core/http/middleware/puterSite.js';
import type { PuterServer } from '../../server.js';
import type { IConfig } from '../../types.js';
import { setupTestServer } from '../../testUtil.js';

// Own file: the subdomain cache is shared in-process, so a server booted
// alongside another would read that server's `puter-app-icons` row.

const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';
const ICONS_PATH = '/system/app_icons';

describe('AppIconService — icons directory owned by another user', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer({
            no_default_user: false,
            api_base_url: 'http://api.puter.localhost:4100',
        } as unknown as IConfig);
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    const fetchIconStatus = async (path: string) => {
        const middleware = createPuterSiteMiddleware(
            {
                domain: 'puter.localhost',
                static_hosting_domain: 'site.puter.localhost',
                protocol: 'http',
            } as unknown as IConfig,
            {
                clients: server.clients,
                stores: server.stores,
                services: server.services,
            },
        );
        let statusCode = 0;
        const res = new Writable({
            write(_chunk, _enc, cb) {
                cb();
            },
        }) as unknown as Response;
        const chain = () => res;
        Object.assign(res, {
            status: (code: number) => {
                statusCode = code;
                return res;
            },
            type: chain,
            send: chain,
            set: chain,
            setHeader: chain,
            cookie: chain,
            redirect: chain,
        });
        const req = {
            hostname: 'puter-app-icons.site.puter.localhost',
            path,
            originalUrl: path,
            protocol: 'http',
            headers: {},
            cookies: {},
            query: {},
            on: () => undefined,
        } as unknown as Request;
        await middleware(req, res, vi.fn());
        await new Promise<void>((resolve) => setImmediate(resolve));
        return statusCode;
    };

    // Databases from older versions have `/system` owned by the `system` user,
    // while the subdomain was registered to the admin.
    it('re-registers the subdomain to the directory owner so icons are served', async () => {
        const uid = `app-${uuidv4()}`;
        await server.clients.event.emitAndWait(
            'app.new-icon',
            { app_uid: uid, data_url: PNG_DATA_URL },
            {},
        );
        const iconPath = `/${uid}-64.png`;
        expect(await fetchIconStatus(iconPath)).toBe(200);

        const systemUser = await server.stores.user.getByUsername('system');
        for (const path of ['/system', ICONS_PATH]) {
            const entry = await server.stores.fsEntry.getEntryByPath(path);
            await server.clients.db.write(
                'UPDATE `fsentries` SET `user_id` = ? WHERE `id` = ?',
                [systemUser!.id, entry!.id],
            );
            await server.stores.fsEntry.invalidateEntryCacheById(entry!.id);
        }
        expect(await fetchIconStatus(iconPath)).toBe(404);

        await server.services.appIcon.ensureIconsDirectory();

        const site =
            await server.stores.subdomain.getBySubdomain('puter-app-icons');
        expect(site?.user_id).toBe(systemUser!.id);
        expect(await fetchIconStatus(iconPath)).toBe(200);
    });
});

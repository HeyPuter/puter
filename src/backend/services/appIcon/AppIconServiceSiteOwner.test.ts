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
import { SYSTEM_ACTOR_UUID } from '../../core/actor.js';
import { createPuterSiteMiddleware } from '../../core/http/middleware/puterSite.js';
import type { PuterServer } from '../../server.js';
import type { IConfig } from '../../types.js';
import { setupTestServer } from '../../testUtil.js';

// Own file: the subdomain cache is shared in-process, so a server booted
// alongside another would read that server's `puter-app-icons` row.

const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';
const ICONS_PATH = '/system/app_icons';

describe('AppIconService — system-owned icons site', () => {
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

    const setOwner = async (path: string, userId: number) => {
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        await server.clients.db.write(
            'UPDATE `fsentries` SET `user_id` = ? WHERE `id` = ?',
            [userId, entry!.id],
        );
        await server.stores.fsEntry.invalidateEntryCacheById(entry!.id);
    };
    const registerSiteTo = async (userId: number) => {
        const site =
            await server.stores.subdomain.getBySubdomain('puter-app-icons');
        await server.stores.subdomain.deleteByUuid(site!.uuid);
        await server.stores.subdomain.create({
            userId,
            subdomain: 'puter-app-icons',
            rootDirId: site!.root_dir_id,
        });
    };

    it('writes icons as the system user into a system-owned site', async () => {
        const systemUser =
            await server.stores.user.getByUuid(SYSTEM_ACTOR_UUID);
        const uid = `app-${uuidv4()}`;
        await server.clients.event.emitAndWait(
            'app.new-icon',
            { app_uid: uid, data_url: PNG_DATA_URL },
            {},
        );

        for (const path of [
            '/system',
            ICONS_PATH,
            `${ICONS_PATH}/${uid}-64.png`,
        ]) {
            expect(
                (await server.stores.fsEntry.getEntryByPath(path))?.userId,
                path,
            ).toBe(systemUser!.id);
        }
        expect(
            (await server.stores.subdomain.getBySubdomain('puter-app-icons'))
                ?.user_id,
        ).toBe(systemUser!.id);
        expect(await fetchIconStatus(`/${uid}-64.png`)).toBe(200);
    });

    // Older databases: the directory belongs to the system user but the
    // subdomain was registered to the admin, so every icon 404s.
    it('re-registers a subdomain the admin holds to the system user', async () => {
        const systemUser =
            await server.stores.user.getByUuid(SYSTEM_ACTOR_UUID);
        const admin = await server.stores.user.getByUsername('admin');
        const uid = `app-${uuidv4()}`;
        await server.clients.event.emitAndWait(
            'app.new-icon',
            { app_uid: uid, data_url: PNG_DATA_URL },
            {},
        );
        const iconPath = `/${uid}-64.png`;

        await registerSiteTo(admin!.id);
        expect(await fetchIconStatus(iconPath)).toBe(404);

        await server.services.appIcon.ensureIconsDirectory();
        expect(
            (await server.stores.subdomain.getBySubdomain('puter-app-icons'))
                ?.user_id,
        ).toBe(systemUser!.id);
        expect(await fetchIconStatus(iconPath)).toBe(200);
    });

    // Databases set up by earlier versions of this service: the directories
    // and the subdomain all belong to the admin.
    it('moves an admin-owned icons site over to the system user', async () => {
        const systemUser =
            await server.stores.user.getByUuid(SYSTEM_ACTOR_UUID);
        const admin = await server.stores.user.getByUsername('admin');
        await setOwner('/system', admin!.id);
        await setOwner(ICONS_PATH, admin!.id);
        await registerSiteTo(admin!.id);

        await server.services.appIcon.ensureIconsDirectory();

        for (const path of ['/system', ICONS_PATH]) {
            expect(
                (await server.stores.fsEntry.getEntryByPath(path))?.userId,
                path,
            ).toBe(systemUser!.id);
        }
        expect(
            (await server.stores.subdomain.getBySubdomain('puter-app-icons'))
                ?.user_id,
        ).toBe(systemUser!.id);
    });
});

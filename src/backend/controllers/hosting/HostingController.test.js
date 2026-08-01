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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { setupTestServer } from '../../testUtil.js';

// `/delete-site` is the only hosting route exposed as a controller endpoint
// (everything else goes through the `puter-subdomains` driver), and it is an
// ownership-gated destructive operation — so the interesting cases are the
// refusals.

let server;
let deleteSite;

beforeAll(async () => {
    server = await setupTestServer();
    const router = new PuterRouter();
    server.controllers.hosting.registerRoutes(router);
    deleteSite = router.routes.find(
        (route) => route.path === '/delete-site',
    ).handler;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async () => {
    const username = `host-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    return {
        userId: created.id,
        username,
        actor: { user: { id: created.id, uuid: created.uuid, username } },
    };
};

const makeSite = async (userId) => {
    const subdomain = `site-${Math.random().toString(36).slice(2, 10)}`;
    return server.stores.subdomain.create({ userId, subdomain });
};

const makeReq = (init) => ({
    body: init.body,
    query: {},
    headers: {},
    actor: init.actor,
});

const makeRes = () => {
    const captured = { statusCode: 200, body: undefined };
    const res = {
        json: vi.fn((value) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code) => {
            captured.statusCode = code;
            return res;
        }),
    };
    return { res, captured };
};

describe('HostingController /delete-site', () => {
    it('rejects a missing site_uuid', async () => {
        const { actor } = await makeUser();
        await expect(
            deleteSite(makeReq({ body: {}, actor }), makeRes().res),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
    });

    it('rejects a non-string site_uuid', async () => {
        const { actor } = await makeUser();
        await expect(
            deleteSite(
                makeReq({ body: { site_uuid: 42 }, actor }),
                makeRes().res,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a missing body entirely', async () => {
        const { actor } = await makeUser();
        await expect(
            deleteSite(makeReq({ body: undefined, actor }), makeRes().res),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('404s a site uuid that does not exist', async () => {
        const { actor } = await makeUser();
        await expect(
            deleteSite(
                makeReq({ body: { site_uuid: uuidv4() }, actor }),
                makeRes().res,
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'not_found',
        });
    });

    it("404s another user's site rather than revealing it exists", async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const site = await makeSite(owner.userId);

        await expect(
            deleteSite(
                makeReq({
                    body: { site_uuid: site.uuid },
                    actor: stranger.actor,
                }),
                makeRes().res,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
        // Still there.
        expect(
            await server.stores.subdomain.getByUuid(site.uuid),
        ).not.toBeNull();
    });

    it('refuses to delete a protected subdomain', async () => {
        const { userId, actor } = await makeUser();
        const site = await makeSite(userId);
        await server.clients.db.write(
            'UPDATE `subdomains` SET `protected` = ? WHERE `uuid` = ?',
            [1, site.uuid],
        );

        await expect(
            deleteSite(
                makeReq({ body: { site_uuid: site.uuid }, actor }),
                makeRes().res,
            ),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'forbidden',
        });
        expect(
            await server.stores.subdomain.getByUuid(site.uuid),
        ).not.toBeNull();
    });

    it('deletes the caller-owned site and answers with an empty object', async () => {
        const { userId, actor } = await makeUser();
        const site = await makeSite(userId);

        const { res, captured } = makeRes();
        await deleteSite(
            makeReq({ body: { site_uuid: site.uuid }, actor }),
            res,
        );
        expect(captured.body).toEqual({});
        expect(await server.stores.subdomain.getByUuid(site.uuid)).toBeNull();
    });
});

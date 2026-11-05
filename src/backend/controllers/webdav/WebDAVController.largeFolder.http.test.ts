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

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithContext } from '../../core/context.js';
import {
    setupPuterTestEnv,
    TEST_OTHER_USER_CREDENTIALS,
    TEST_USER_CREDENTIALS,
    type PuterTestEnv,
} from '../../testUtil.js';

/** PROPFIND has no paging, so a folder must list whole however large. */
describe('PROPFIND on a folder larger than one query', () => {
    let env: PuterTestEnv;
    const total = 10_050;
    let dir: string;
    let dirUuid: string;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        const { username } = env.users.user;
        dir = `/${username}/Documents/big-${randomUUID().slice(0, 8)}`;
        const owner = (await env.server.stores.user.getByUsername(username))!;
        const parent = (await env.server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents`,
        ))!;
        dirUuid = randomUUID();
        const now = Math.floor(Date.now() / 1000);
        const insert = (rows: unknown[][]) =>
            env.server.clients.db.write(
                `INSERT INTO fsentries (uuid, user_id, parent_id, parent_uid, name, path, is_dir, modified, created, accessed, size) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
                rows.flat(),
            );
        await insert([
            [
                dirUuid,
                owner.id,
                parent.id,
                parent.uuid,
                dir.split('/').at(-1),
                dir,
                1,
                now,
                now,
                now,
                0,
            ],
        ]);
        const folder = (await env.server.stores.fsEntry.getEntryByPath(dir))!;
        for (let start = 0; start < total; start += 500) {
            const rows: unknown[][] = [];
            for (let i = start; i < Math.min(total, start + 500); i++) {
                const name = `f${String(i).padStart(5, '0')}.txt`;
                rows.push([
                    randomUUID(),
                    owner.id,
                    folder.id,
                    folder.uuid,
                    name,
                    `${dir}/${name}`,
                    0,
                    now,
                    now,
                    now,
                    0,
                ]);
            }
            await insert(rows);
        }

        const actor = { user: owner };
        await runWithContext({ actor: actor as never }, () =>
            env.server.services.share.share(actor as never, {
                uid: dirUuid,
                recipient: { username: env.users.other.username },
                mode: 'read',
            }),
        );
    }, 180_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const propfind = async (
        path: string,
        credentials: { username: string; password: string },
    ) => {
        const port = new URL(env.apiOrigin).port;
        const auth = Buffer.from(
            `${credentials.username}:${credentials.password}`,
        ).toString('base64');
        const response = await fetch(
            `http://dav.puter.localhost:${port}${encodeURI(path)}`,
            {
                method: 'PROPFIND',
                headers: { Authorization: `Basic ${auth}`, Depth: '1' },
            },
        );
        return { status: response.status, body: await response.text() };
    };

    const hrefsOf = (xml: string) =>
        [...xml.matchAll(/<D:href>([^<]*)<\/D:href>/g)].map((m) => m[1]!);

    it('lists every child', async () => {
        const { status, body } = await propfind(dir, TEST_USER_CREDENTIALS);
        expect(status).toBe(207);
        expect(body.endsWith('</D:multistatus>')).toBe(true);
        const hrefs = hrefsOf(body);
        expect(hrefs).toHaveLength(1 + total);
        expect(new Set(hrefs).size).toBe(1 + total);
        expect(body).toContain(`${dir}/f10049.txt`);
    }, 60_000);

    it("masks every page of a share recipient's listing", async () => {
        const masked = `/${env.users.user.username}/${dirUuid}/${dir.split('/').at(-1)}`;
        const { status, body } = await propfind(
            masked,
            TEST_OTHER_USER_CREDENTIALS,
        );
        expect(status).toBe(207);
        const hrefs = hrefsOf(body);
        expect(hrefs).toHaveLength(1 + total);
        expect(hrefs.every((href) => href.startsWith(masked))).toBe(true);
        expect(body).not.toContain('/Documents/');
    }, 60_000);
});

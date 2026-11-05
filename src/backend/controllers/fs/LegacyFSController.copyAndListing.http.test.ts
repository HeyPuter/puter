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
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

let env: PuterTestEnv;

beforeAll(async () => {
    env = await setupPuterTestEnv();
}, 120_000);

afterAll(async () => {
    await env?.shutdown();
});

const post = (path: string, body: unknown) =>
    fetch(new URL(path, env.apiOrigin), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.users.user.token}`,
        },
        body: JSON.stringify(body),
    });

const write = (path: string, content: string) =>
    post('/fs/write', {
        fileMetadata: { path, size: content.length, contentType: 'text/plain' },
        fileContent: content,
    });

const read = async (path: string) => {
    const url = new URL('/read', env.apiOrigin);
    url.searchParams.set('file', path);
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${env.users.user.token}` },
    });
    return response.text();
};

const makeDir = async (name: string) => {
    const path = `/${env.users.user.username}/Documents/${name}-${randomUUID().slice(0, 8)}`;
    expect((await post('/fs/mkdir', { path })).status).toBe(200);
    return path;
};

describe('legacy /copy onto an existing file', () => {
    it('replaces the file with overwrite', async () => {
        const dir = await makeDir('copy-onto');
        expect((await write(`${dir}/a.txt`, 'aaa')).status).toBe(200);
        expect((await write(`${dir}/b.txt`, 'bbbbbb')).status).toBe(200);

        const copy = await post('/copy', {
            source: `${dir}/a.txt`,
            destination: `${dir}/b.txt`,
            overwrite: true,
        });
        expect(copy.status).toBe(200);
        const [result] = (await copy.json()) as Array<{
            copied: { name: string; path: string };
            overwritten?: { name: string };
        }>;
        expect(result!.copied.name).toBe('b.txt');
        expect(result!.overwritten?.name).toBe('b.txt');
        expect(await read(`${dir}/b.txt`)).toBe('aaa');
        expect(await read(`${dir}/a.txt`)).toBe('aaa');
    });

    it('refuses without overwrite and leaves the file alone', async () => {
        const dir = await makeDir('copy-onto-refused');
        await write(`${dir}/a.txt`, 'aaa');
        await write(`${dir}/b.txt`, 'bbbbbb');

        const copy = await post('/copy', {
            source: `${dir}/a.txt`,
            destination: `${dir}/b.txt`,
        });
        expect(copy.status).toBe(409);
        expect(((await copy.json()) as { code: string }).code).toBe(
            'item_with_same_name_exists',
        );
        expect(await read(`${dir}/b.txt`)).toBe('bbbbbb');
    });

    it('still copies into a directory destination under the same name', async () => {
        const dir = await makeDir('copy-into');
        await write(`${dir}/a.txt`, 'aaa');
        expect((await post('/fs/mkdir', { path: `${dir}/sub` })).status).toBe(
            200,
        );

        const copy = await post('/copy', {
            source: `${dir}/a.txt`,
            destination: `${dir}/sub`,
        });
        expect(copy.status).toBe(200);
        expect(await read(`${dir}/sub/a.txt`)).toBe('aaa');
    });

    it('refuses to overwrite a file with itself', async () => {
        const dir = await makeDir('copy-self');
        await write(`${dir}/a.txt`, 'aaa');

        for (const destination of [`${dir}/a.txt`, dir]) {
            const copy = await post('/copy', {
                source: `${dir}/a.txt`,
                destination,
                overwrite: true,
            });
            expect(copy.status).toBe(400);
        }
        expect(await read(`${dir}/a.txt`)).toBe('aaa');
    });
});

describe('signed folder listing', () => {
    const signedListing = async (path: string) => {
        const signed = await post('/sign', {
            items: [{ path, action: 'read' }],
        });
        expect(signed.status).toBe(200);
        const readUrl = new URL(
            (await signed.json()).signatures[0].read_url as string,
        );
        return fetch(
            new URL(`${readUrl.pathname}${readUrl.search}`, env.apiOrigin),
        );
    };

    it('lists every child of a folder larger than one query', async () => {
        const dir = await makeDir('big');
        const parent = (await env.server.stores.fsEntry.getEntryByPath(dir))!;
        const total = 10_050;
        const now = Math.floor(Date.now() / 1000);
        for (let start = 0; start < total; start += 500) {
            const rows: unknown[][] = [];
            for (let i = start; i < Math.min(total, start + 500); i++) {
                const name = `f${String(i).padStart(5, '0')}.txt`;
                rows.push([
                    randomUUID(),
                    parent.userId,
                    parent.id,
                    parent.uuid,
                    name,
                    `${dir}/${name}`,
                    0,
                    now,
                    now,
                    now,
                    0,
                ]);
            }
            await env.server.clients.db.write(
                `INSERT INTO fsentries (uuid, user_id, parent_id, parent_uid, name, path, is_dir, modified, created, accessed, size) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
                rows.flat(),
            );
        }

        const response = await signedListing(dir);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(
            /^application\/json/,
        );
        const children = (await response.json()) as Array<{
            fsentry_name: string;
            write_url?: string;
        }>;
        expect(children).toHaveLength(total);
        expect(children[0]!.fsentry_name).toBe('f00000.txt');
        expect(children.at(-1)!.fsentry_name).toBe('f10049.txt');
        expect(new Set(children.map((c) => c.fsentry_name)).size).toBe(total);
        expect(children.some((c) => c.write_url)).toBe(false);
    }, 120_000);

    it('answers a small folder in one body', async () => {
        const dir = await makeDir('small');
        await write(`${dir}/one.txt`, '1');
        const response = await signedListing(dir);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-length')).not.toBeNull();
        const children = (await response.json()) as Array<{
            fsentry_name: string;
        }>;
        expect(children.map((c) => c.fsentry_name)).toEqual(['one.txt']);
    });
});

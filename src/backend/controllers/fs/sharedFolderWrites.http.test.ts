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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

// A recipient addresses the owner's entries by a masked `/<owner>/<uuid>/<name>`
// path. Routes that create an entry have no row to resolve, so they unmask it
// themselves before the ACL check runs against the result.
describe('writes inside a folder shared with write', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 180_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = async (route: string, token: string, body: unknown) => {
        const res = await fetch(new URL(route, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        return {
            status: res.status,
            json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        };
    };

    const makeUser = () =>
        createTestUser(env.server, {
            username: `sfw${Math.random().toString(36).slice(2, 9)}`,
            password: 'puter-test-user-password',
        });

    /** `/<owner>/SharedDir` with `note.txt`, shared `write` with a recipient. */
    const shareAFolder = async () => {
        const owner = await makeUser();
        const recipient = await makeUser();
        const dir = await post('/mkdir', owner.token, {
            path: `/${owner.username}/SharedDir`,
        });
        await post('/touch', owner.token, {
            path: `/${owner.username}/SharedDir/note.txt`,
        });
        const note = await post('/stat', owner.token, {
            path: `/${owner.username}/SharedDir/note.txt`,
        });
        await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: dir.json!.uid }],
            mode: 'write',
        });
        return {
            owner,
            recipient,
            realDir: `/${owner.username}/SharedDir`,
            maskedDir: `/${owner.username}/${dir.json!.uid}/SharedDir`,
            noteUid: note.json!.uid as string,
        };
    };

    const ownerListing = async (s: { owner: { token: string; username: string } }) => {
        const res = await post('/readdir', s.owner.token, {
            path: `/${s.owner.username}/SharedDir`,
        });
        return (res.json as unknown as Array<{ name: string }>).map(
            (entry) => entry.name,
        );
    };

    // `{parent, path}` is the shape puter.js sends — the GUI's "New Folder".
    it('mkdir accepts a masked parent', async () => {
        const s = await shareAFolder();

        const made = await post('/mkdir', s.recipient.token, {
            parent: s.maskedDir,
            path: 'New Folder',
        });

        expect(made.status).toBe(200);
        expect(made.json).toMatchObject({
            name: 'New Folder',
            is_dir: true,
            // Anchored to the share root the request came through, so the
            // recipient can navigate into what they just made.
            path: `${s.maskedDir}/New Folder`,
        });
        expect(await ownerListing(s)).toContain('New Folder');
    }, 180_000);

    it('mkdir accepts a masked absolute path', async () => {
        const s = await shareAFolder();

        const made = await post('/mkdir', s.recipient.token, {
            path: `${s.maskedDir}/Reports`,
        });

        expect(made.status).toBe(200);
        expect(await ownerListing(s)).toContain('Reports');
    }, 180_000);

    it('touch accepts a masked path', async () => {
        const s = await shareAFolder();

        const touched = await post('/touch', s.recipient.token, {
            path: `${s.maskedDir}/from-recipient.txt`,
        });

        expect(touched.status).toBe(200);
        expect(await ownerListing(s)).toContain('from-recipient.txt');
    }, 180_000);

    it('touch still expands a tilde path', async () => {
        const s = await shareAFolder();

        const touched = await post('/touch', s.owner.token, {
            path: '~/SharedDir/from-tilde.txt',
        });

        expect(touched.status).toBe(200);
        expect(await ownerListing(s)).toContain('from-tilde.txt');
    }, 180_000);

    // Addressed to the owner, so it carries the path the owner can resolve.
    it('publishes the owner’s real path on events about their entries', async () => {
        const s = await shareAFolder();
        const seen: Array<Record<string, unknown>> = [];
        const emit = env.server.clients.event.emit.bind(
            env.server.clients.event,
        );
        vi.spyOn(env.server.clients.event, 'emit').mockImplementation(
            ((name: string, payload: Record<string, unknown>, meta: unknown) => {
                if (name.startsWith('outer.gui.item.')) {
                    seen.push(payload);
                }
                return emit(
                    name as never,
                    payload as never,
                    meta as never,
                );
            }) as never,
        );

        const moved = await post('/move', s.recipient.token, {
            source: s.noteUid,
            destination: s.maskedDir,
            new_name: 'renamed.txt',
        });
        expect(moved.status).toBe(200);

        const ownerId = (await env.server.stores.user.getByUsername(
            s.owner.username,
        ))!.id;
        const event = seen.find(
            (payload) =>
                (payload.response as { uid?: string })?.uid === s.noteUid,
        );
        expect(event?.user_id_list).toEqual([ownerId]);
        expect(event?.response).toMatchObject({
            path: `${s.realDir}/renamed.txt`,
            dirpath: s.realDir,
        });

        // The recipient's own response stays masked.
        expect(
            (moved.json!.moved as { path: string }).path,
        ).toBe(`${s.maskedDir}/renamed.txt`);
    }, 180_000);

    // The thumbnail update is scoped to the writer's own rows, so a file the
    // owner ends up owning keeps none, while the writer's own file in the same
    // batch gets its thumbnail.
    it('batchWrite stores thumbnails on the writer’s own files only', async () => {
        const s = await shareAFolder();
        const png =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const ownPath = `/${s.recipient.username}/Documents/own.png`;
        const written = await post('/fs/batchWrite', s.recipient.token, [
            {
                fileMetadata: { path: `${s.maskedDir}/shared.png`, size: 1 },
                fileContent: 'a',
                thumbnailData: png,
            },
            {
                fileMetadata: { path: ownPath, size: 1 },
                fileContent: 'b',
                thumbnailData: png,
            },
        ]);
        expect(written.status).toBe(200);

        const stored = async (path: string) =>
            env.server.stores.fsEntry.getEntryByUuidFromPrimary(
                (await env.server.stores.fsEntry.getEntryByPath(path))!.uuid,
            );
        expect((await stored(`${s.realDir}/shared.png`))?.thumbnail).toBeNull();
        expect((await stored(ownPath))?.thumbnail).toMatch(/^s3:\/\//);
    }, 180_000);

    // The recipient only knows the masked path, so refusals name entries the
    // way the recipient addressed them.
    it('keeps the owner’s real path out of error messages', async () => {
        const s = await shareAFolder();
        await post('/touch', s.owner.token, {
            path: `${s.realDir}/other.txt`,
        });

        const cases = [
            {
                res: await post('/fs/stat', s.recipient.token, {
                    path: `${s.maskedDir}/missing.txt`,
                }),
                status: 404,
                message: 'Subject does not exist',
            },
            {
                res: await post('/fs/mkdir', s.recipient.token, {
                    path: `${s.maskedDir}/note.txt`,
                }),
                status: 409,
                message: 'An entry named `note.txt` already exists',
            },
            {
                res: await post('/fs/mkdir', s.recipient.token, {
                    path: `${s.maskedDir}/missing/child`,
                }),
                status: 404,
                message: 'Parent path does not exist: missing',
            },
            {
                res: await post('/fs/rename', s.recipient.token, {
                    uid: s.noteUid,
                    new_name: 'other.txt',
                }),
                status: 409,
                message: 'An entry named `other.txt` already exists',
            },
            {
                res: await post('/mkdir', s.recipient.token, {
                    path: `${s.maskedDir}/note.txt`,
                }),
                status: 409,
                message: 'An entry named `note.txt` already exists',
            },
        ];
        for (const { res, status, message } of cases) {
            expect(res.status).toBe(status);
            expect(res.json!.message).toBe(message);
            expect(JSON.stringify(res.json)).not.toContain(s.realDir);
        }
    }, 180_000);

    describe('a file the recipient opened with an app', () => {
        const makeApp = (ownerUserId: number) =>
            (
                env.server.stores.app.create as unknown as (
                    fields: Record<string, unknown>,
                    opts: { ownerUserId: number },
                ) => Promise<{ uid: string; id: number }>
            )(
                {
                    name: `sfw-app-${Math.random().toString(36).slice(2, 9)}`,
                    title: 'Shared folder app',
                    index_url: `https://sfw-${Math.random().toString(36).slice(2, 9)}.test/`,
                },
                { ownerUserId },
            );

        /** Opens `note.txt` with a new app, as a launch does. */
        const openWithApp = async (
            s: Awaited<ReturnType<typeof shareAFolder>>,
        ) => {
            const recipientId = (await env.server.stores.user.getByUsername(
                s.recipient.username,
            ))!.id;
            const app = await makeApp(recipientId);
            const signed = await post('/sign', s.recipient.token, {
                items: [{ uid: s.noteUid, action: 'write' }],
                app_uid: app.uid,
            });
            expect(signed.status).toBe(200);
            return { app, appToken: signed.json!.token as string };
        };

        const read = async (token: string, query: Record<string, string>) => {
            const res = await fetch(
                new URL(`/read?${new URLSearchParams(query)}`, env.apiOrigin),
                { headers: { authorization: `Bearer ${token}` } },
            );
            return { status: res.status, text: await res.text() };
        };

        const write = (token: string, path: string, content: string) =>
            post('/fs/write', token, {
                fileMetadata: {
                    path,
                    size: content.length,
                    contentType: 'text/plain',
                    overwrite: true,
                },
                fileContent: content,
            });

        it('reads and saves it by path and uid', async () => {
            const s = await shareAFolder();
            const { appToken } = await openWithApp(s);
            const masked = `${s.maskedDir}/note.txt`;
            const real = `${s.realDir}/note.txt`;

            expect((await write(appToken, masked, 'one')).status).toBe(200);
            expect(await read(appToken, { uid: s.noteUid })).toEqual({
                status: 200,
                text: 'one',
            });
            expect((await write(appToken, real, 'two')).status).toBe(200);
            expect(await read(appToken, { file: real })).toEqual({
                status: 200,
                text: 'two',
            });
            expect(
                (await post('/stat', appToken, { uid: s.noteUid })).status,
            ).toBe(200);
        }, 180_000);

        it('only reads it once the share drops to read', async () => {
            const s = await shareAFolder();
            const { appToken } = await openWithApp(s);
            const dir = await post('/stat', s.owner.token, { path: s.realDir });
            const reshared = await post('/share', s.owner.token, {
                recipients: [s.recipient.username],
                items: [{ uid: dir.json!.uid }],
                mode: 'read',
            });
            expect(reshared.status).toBe(200);

            expect((await read(appToken, { uid: s.noteUid })).status).toBe(200);
            expect(
                (await write(appToken, `${s.maskedDir}/note.txt`, 'x')).status,
            ).toBe(403);
        }, 180_000);

        it('gives nothing to another app of the recipient', async () => {
            const s = await shareAFolder();
            await openWithApp(s);
            const recipientId = (await env.server.stores.user.getByUsername(
                s.recipient.username,
            ))!.id;
            const other = await makeApp(recipientId);
            const minted = await post(
                '/auth/get-user-app-token',
                s.recipient.token,
                { app_uid: other.uid },
            );
            expect(minted.status).toBe(200);
            const otherToken = minted.json!.token as string;

            expect([403, 404]).toContain(
                (await read(otherToken, { uid: s.noteUid })).status,
            );
            expect([403, 404]).toContain(
                (await write(otherToken, `${s.maskedDir}/note.txt`, 'x'))
                    .status,
            );
        }, 180_000);
    });
});

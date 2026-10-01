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
});

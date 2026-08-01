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

/**
 * `puter_path` resolution for the OpenAI Chat Completions providers.
 *
 * Chat Completions has no file-upload channel, so user-supplied media has to be
 * inlined as base64 data URLs. This suite drives the real FS stack (a booted
 * PuterServer with in-memory sqlite + s3) so the ACL check, the MIME sniff, and
 * the size gate are all the production ones.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../../../core/actor.js';
import { runWithContext } from '../../../../core/context.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { generateDefaultFsentries } from '../../../../util/userProvisioning.js';
import { MAX_FILE_SIZE, processPuterPathUploads } from './fileUpload.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `oaifu-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

const writeFile = async (
    actor: Actor,
    userId: number,
    path: string,
    body: Buffer,
    contentType: string,
) =>
    runWithContext({ actor }, () =>
        server.services.fs.write(userId, {
            fileMetadata: { path, size: body.byteLength, contentType },
            fileContent: body,
        }),
    );

const resolve = (
    messages: Array<{ content?: unknown }>,
    actor: Actor | undefined,
) =>
    processPuterPathUploads(
        messages,
        { fsEntry: server.stores.fsEntry, s3Object: server.stores.s3Object },
        server.services.fs,
        actor,
    );

const errorText = (reason: string) =>
    `{error: ${reason}; the user did not write this message}`;

// -- Media inlining --------------------------------------------------

describe('processPuterPathUploads media inlining', () => {
    it('rewrites an image reference into an inline base64 image_url part', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/pic.png`;
        const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        await writeFile(actor, userId, path, body, 'image/png');

        const part: Record<string, unknown> = { puter_path: path };
        await resolve([{ content: [part] }], actor);

        expect(part.type).toBe('image_url');
        expect(part.image_url).toEqual({
            url: `data:image/png;base64,${body.toString('base64')}`,
        });
        // The reference is consumed so it never reaches the upstream API.
        expect('puter_path' in part).toBe(false);
    });

    it('rewrites an audio reference into input_audio with the subtype as format', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/clip.mp3`;
        const body = Buffer.from('fake-mp3-bytes');
        await writeFile(actor, userId, path, body, 'audio/mpeg');

        const part: Record<string, unknown> = { puter_path: path };
        await resolve([{ content: [part] }], actor);

        expect(part.type).toBe('input_audio');
        expect(part.input_audio).toEqual({
            data: `data:audio/mpeg;base64,${body.toString('base64')}`,
            format: 'mpeg',
        });
    });

    it('resolves every referenced part across every message in one pass', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const one = `/${username}/Documents/a.png`;
        const two = `/${username}/Documents/b.png`;
        await writeFile(actor, userId, one, Buffer.from('a'), 'image/png');
        await writeFile(actor, userId, two, Buffer.from('b'), 'image/png');

        const first: Record<string, unknown> = { puter_path: one };
        const second: Record<string, unknown> = { puter_path: two };
        await resolve(
            [
                { content: [{ type: 'text', text: 'look' }, first] },
                { content: [second] },
            ],
            actor,
        );

        expect(first.image_url).toEqual({
            url: `data:image/png;base64,${Buffer.from('a').toString('base64')}`,
        });
        expect(second.image_url).toEqual({
            url: `data:image/png;base64,${Buffer.from('b').toString('base64')}`,
        });
    });
});

// -- Parts that are left alone ---------------------------------------

describe('processPuterPathUploads pass-through', () => {
    it('leaves string content and parts without puter_path untouched', async () => {
        const { actor } = await makeUser();
        const plainPart = { type: 'text', text: 'hello' };
        const messages = [
            { content: 'a plain string message' },
            { content: [plainPart, null] },
            {},
        ] as Array<{ content?: unknown }>;

        await resolve(messages, actor);

        expect(messages[0]!.content).toBe('a plain string message');
        expect(plainPart).toEqual({ type: 'text', text: 'hello' });
    });
});

// -- Rejection paths -------------------------------------------------

describe('processPuterPathUploads rejection paths', () => {
    it('replaces the part with an inline error when the caller is unauthenticated', async () => {
        const part: Record<string, unknown> = { puter_path: '/anyone/x.png' };
        await resolve([{ content: [part] }], undefined);

        expect(part.type).toBe('text');
        expect(part.text).toBe(
            errorText('unauthenticated caller cannot resolve puter_path'),
        );
    });

    it('replaces the part with an inline error for an unsupported MIME type', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/notes.pdf`;
        await writeFile(
            actor,
            userId,
            path,
            Buffer.from('%PDF-1.4'),
            'application/pdf',
        );

        const part: Record<string, unknown> = { puter_path: path };
        await resolve([{ content: [part] }], actor);

        expect(part.type).toBe('text');
        expect(part.text).toBe(
            errorText('input file has unsupported MIME type'),
        );
    });

    it('reports the size cap when the file exceeds MAX_FILE_SIZE', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/huge.png`;
        await writeFile(
            actor,
            userId,
            path,
            Buffer.alloc(MAX_FILE_SIZE + 1, 0x41),
            'image/png',
        );

        const part: Record<string, unknown> = { puter_path: path };
        await resolve([{ content: [part] }], actor);

        expect(part.type).toBe('text');
        expect(part.text).toBe(
            errorText(`input file exceeded maximum of ${MAX_FILE_SIZE} bytes`),
        );
    });

    it('surfaces the underlying message when the referenced file is missing', async () => {
        const { actor } = await makeUser();
        const part: Record<string, unknown> = {
            puter_path: '/nobody/Documents/ghost.png',
        };
        await resolve([{ content: [part] }], actor);

        expect(part.type).toBe('text');
        expect(typeof part.text).toBe('string');
        expect(part.text).toMatch(/^\{error: /);
        expect(part.text).not.toMatch(/exceeded maximum/);
    });

    it("does not leak another user's file through a puter_path reference", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const ownerName = owner.actor.user!.username!;
        const path = `/${ownerName}/Documents/secret.png`;
        await writeFile(
            owner.actor,
            owner.userId,
            path,
            Buffer.from('top-secret'),
            'image/png',
        );

        const part: Record<string, unknown> = { puter_path: path };
        await resolve([{ content: [part] }], intruder.actor);

        expect(part.type).toBe('text');
        expect(part.image_url).toBeUndefined();
        expect(part.text).not.toContain('top-secret');
    });

    it('drops any previously-set media fields when swapping in an error', async () => {
        const { actor } = await makeUser();
        const part: Record<string, unknown> = {
            puter_path: '/nobody/Documents/ghost.png',
            image_url: { url: 'data:image/png;base64,stale' },
            input_audio: { data: 'stale', format: 'mpeg' },
        };
        await resolve([{ content: [part] }], actor);

        expect(part.type).toBe('text');
        expect('image_url' in part).toBe(false);
        expect('input_audio' in part).toBe(false);
    });
});

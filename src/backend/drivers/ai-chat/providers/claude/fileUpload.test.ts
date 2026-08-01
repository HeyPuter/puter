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
 * `puter_path` resolution for the Claude provider.
 *
 * Unlike Chat Completions, Anthropic has a Files API — referenced FS entries
 * are uploaded and the content part is rewritten to point at the returned
 * `file_id`. The FS side runs against a real booted PuterServer; only the
 * Anthropic client (the network egress point) is stubbed.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../../../core/actor.js';
import { runWithContext } from '../../../../core/context.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { generateDefaultFsentries } from '../../../../util/userProvisioning.js';
import { FILES_API_BETA, processPuterPathUploads } from './fileUpload.js';

const CLAUDE_MAX_FILE_SIZE = 30 * 1_000_000;

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `clfu-${Math.random().toString(36).slice(2, 10)}`;
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

/**
 * Stub Anthropic client. `beta.files.upload` is the single external call the
 * uploader makes; everything else stays real.
 */
const makeAnthropicStub = () => {
    let n = 0;
    const upload = vi
        .fn()
        .mockImplementation(async () => ({ id: `file_${++n}` }));
    return {
        upload,
        client: { beta: { files: { upload } } } as unknown as Anthropic,
    };
};

const errorText = (reason: string) =>
    `{error: ${reason}; the user did not write this message}`;

// -- Uploading -------------------------------------------------------

describe('claude processPuterPathUploads uploading', () => {
    it('does not touch the Files API when no part references a puter_path', async () => {
        const { actor } = await makeUser();
        const { client, upload } = makeAnthropicStub();

        const result = await processPuterPathUploads(
            client,
            [
                { content: 'plain string' },
                { content: [{ type: 'text', text: 'hi' }, null] },
                {},
            ] as Array<{ content?: unknown }>,
            server.stores,
            server.services.fs,
            actor,
        );

        expect(upload).not.toHaveBeenCalled();
        expect(result).toEqual({ fileIds: [] });
    });

    it('uploads an image and rewrites the part to an image block referencing the file_id', async () => {
        const { actor, userId } = await makeUser();
        const { client, upload } = makeAnthropicStub();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/pic.png`;
        await writeFile(
            actor,
            userId,
            path,
            Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            'image/png',
        );

        const part: Record<string, unknown> = { puter_path: path };
        const result = await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(upload).toHaveBeenCalledTimes(1);
        const uploadArgs = upload.mock.calls[0]![0];
        expect(uploadArgs.betas).toEqual([FILES_API_BETA]);
        expect(uploadArgs.file).toBeDefined();

        expect(part.type).toBe('image');
        expect(part.source).toEqual({ type: 'file', file_id: 'file_1' });
        expect('puter_path' in part).toBe(false);
        // The caller deletes these after the completion returns.
        expect(result.fileIds).toEqual(['file_1']);
    });

    it('maps text/* and PDF content to document blocks', async () => {
        const { actor, userId } = await makeUser();
        const { client } = makeAnthropicStub();
        const username = actor.user!.username!;
        const textPath = `/${username}/Documents/notes.txt`;
        const pdfPath = `/${username}/Documents/report.pdf`;
        await writeFile(
            actor,
            userId,
            textPath,
            Buffer.from('notes'),
            'text/plain',
        );
        await writeFile(
            actor,
            userId,
            pdfPath,
            Buffer.from('%PDF-1.4'),
            'application/pdf',
        );

        const textPart: Record<string, unknown> = { puter_path: textPath };
        const pdfPart: Record<string, unknown> = { puter_path: pdfPath };
        const result = await processPuterPathUploads(
            client,
            [{ content: [textPart] }, { content: [pdfPart] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(textPart.type).toBe('document');
        expect(pdfPart.type).toBe('document');
        expect(result.fileIds).toHaveLength(2);
    });

    it('falls back to container_upload for types Claude has no dedicated block for', async () => {
        const { actor, userId } = await makeUser();
        const { client } = makeAnthropicStub();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/archive.zip`;
        await writeFile(
            actor,
            userId,
            path,
            Buffer.from('PK'),
            'application/zip',
        );

        const part: Record<string, unknown> = { puter_path: path };
        await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(part.type).toBe('container_upload');
        expect(part.source).toEqual({ type: 'file', file_id: 'file_1' });
    });
});

// -- Rejection paths -------------------------------------------------

describe('claude processPuterPathUploads rejection paths', () => {
    it('replaces the part with an inline error when the caller is unauthenticated', async () => {
        const { client, upload } = makeAnthropicStub();
        const part: Record<string, unknown> = { puter_path: '/anyone/x.png' };

        const result = await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            undefined,
        );

        expect(upload).not.toHaveBeenCalled();
        expect(part.type).toBe('text');
        expect(part.text).toBe(
            errorText('unauthenticated caller cannot resolve puter_path'),
        );
        expect(result.fileIds).toEqual([]);
    });

    it('reports the size cap when the referenced file exceeds the 30MB limit', async () => {
        const { actor } = await makeUser();
        const { client, upload } = makeAnthropicStub();
        // Anthropic's Files API answers oversize uploads with a 413; the FS
        // size gate raises the same status. Either must produce the stable
        // size message rather than leaking the underlying wording.
        upload.mockRejectedValueOnce(
            Object.assign(new Error('payload too large'), { status: 413 }),
        );
        const { userId } = { userId: actor.user!.id! };
        const username = actor.user!.username!;
        const path = `/${username}/Documents/big.png`;
        await writeFile(
            actor,
            userId,
            path,
            Buffer.from('small-on-disk'),
            'image/png',
        );

        const part: Record<string, unknown> = { puter_path: path };
        const result = await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(part.type).toBe('text');
        expect(part.text).toBe(
            errorText(
                `input file exceeded maximum of ${CLAUDE_MAX_FILE_SIZE} bytes`,
            ),
        );
        expect(result.fileIds).toEqual([]);
    });

    it('surfaces the upstream message for any other upload failure', async () => {
        const { actor, userId } = await makeUser();
        const { client, upload } = makeAnthropicStub();
        upload.mockRejectedValueOnce(
            Object.assign(new Error('anthropic is down'), { status: 503 }),
        );
        const username = actor.user!.username!;
        const path = `/${username}/Documents/pic.png`;
        await writeFile(actor, userId, path, Buffer.from('x'), 'image/png');

        const part: Record<string, unknown> = { puter_path: path };
        await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(part.type).toBe('text');
        expect(part.text).toBe(errorText('anthropic is down'));
    });

    it('falls back to a generic message when the failure carries no message', async () => {
        const { actor, userId } = await makeUser();
        const { client, upload } = makeAnthropicStub();
        upload.mockRejectedValueOnce({});
        const username = actor.user!.username!;
        const path = `/${username}/Documents/pic.png`;
        await writeFile(actor, userId, path, Buffer.from('x'), 'image/png');

        const part: Record<string, unknown> = { puter_path: path };
        await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(part.text).toBe(errorText('failed to read input file'));
    });

    it("does not upload another user's file", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const { client, upload } = makeAnthropicStub();
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
        const result = await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            intruder.actor,
        );

        expect(upload).not.toHaveBeenCalled();
        expect(part.type).toBe('text');
        expect(part.source).toBeUndefined();
        expect(result.fileIds).toEqual([]);
    });

    it('drops a stale source block when swapping in an error', async () => {
        const { actor } = await makeUser();
        const { client } = makeAnthropicStub();
        const part: Record<string, unknown> = {
            puter_path: '/nobody/Documents/ghost.png',
            source: { type: 'file', file_id: 'stale' },
        };

        await processPuterPathUploads(
            client,
            [{ content: [part] }],
            server.stores,
            server.services.fs,
            actor,
        );

        expect(part.type).toBe('text');
        expect('source' in part).toBe(false);
    });
});

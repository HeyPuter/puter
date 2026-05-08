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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { inferFilenameFromUrlOrPath, loadFileInput } from './fileInput.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one real PuterServer (in-memory sqlite + dynamo + s3 + mock
// redis) and exercises `loadFileInput` against the live wired stores
// and FSService. Each test makes its own user via `makeUser` and,
// where the FS-resolution path is being exercised, writes a real
// file through FSService.write so there's an actual fsentry +
// in-memory S3 object behind the path / uuid we hand to loadFileInput.

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `fic-${Math.random().toString(36).slice(2, 10)}`;
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

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

const writeFile = async (
    userId: number,
    path: string,
    body: Buffer,
    contentType = 'application/octet-stream',
) => {
    const result = await server.services.fs.write(userId, {
        fileMetadata: {
            path,
            size: body.byteLength,
            contentType,
        },
        fileContent: body,
    });
    return result.fsEntry;
};

const callLoadFileInput = (
    actor: Actor,
    input: unknown,
    options?: Parameters<typeof loadFileInput>[4],
) =>
    withActor(actor, () =>
        loadFileInput(
            server.stores,
            server.services.fs,
            actor,
            input,
            options,
        ),
    );

// ── inferFilenameFromUrlOrPath ─────────────────────────────────────

describe('inferFilenameFromUrlOrPath', () => {
    it('returns the basename of a URL pathname', () => {
        expect(inferFilenameFromUrlOrPath('https://cdn.test/a/b/photo.png')).toBe(
            'photo.png',
        );
    });

    it('returns the basename of a posix-style path string', () => {
        expect(inferFilenameFromUrlOrPath('/alice/Music/song.mp3')).toBe(
            'song.mp3',
        );
    });

    it('falls back to the supplied default when there is no basename', () => {
        // Empty string has no URL form and no posix basename, so the
        // explicit fallback wins.
        expect(inferFilenameFromUrlOrPath('', 'fallback-name')).toBe(
            'fallback-name',
        );
    });

    it('uses the literal `input` as fallback when no override is passed', () => {
        expect(inferFilenameFromUrlOrPath('')).toBe('input');
    });

    it('handles bare filenames (no slashes, not a URL)', () => {
        expect(inferFilenameFromUrlOrPath('plain.txt')).toBe('plain.txt');
    });
});

// ── loadFileInput — argument validation ─────────────────────────────

describe('loadFileInput validation', () => {
    it('throws 400 when input is empty/falsy', async () => {
        const { actor } = await makeUser();
        await expect(callLoadFileInput(actor, undefined)).rejects.toMatchObject(
            { statusCode: 400 },
        );
        await expect(callLoadFileInput(actor, null)).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(callLoadFileInput(actor, '')).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it('throws 401 when actor.user.id is not a finite number', async () => {
        // Missing actor entirely
        await expect(
            loadFileInput(
                server.stores,
                server.services.fs,
                undefined as unknown as Actor,
                'data:text/plain,hi',
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
        // Actor with no user
        await expect(
            loadFileInput(
                server.stores,
                server.services.fs,
                {} as Actor,
                'data:text/plain,hi',
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
        // Actor with non-numeric user.id
        await expect(
            loadFileInput(
                server.stores,
                server.services.fs,
                { user: { id: 'nope' } } as unknown as Actor,
                'data:text/plain,hi',
            ),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── loadFileInput — data URL path ───────────────────────────────────

describe('loadFileInput data URL', () => {
    it('decodes a base64 data URL and reports the declared MIME', async () => {
        const { actor } = await makeUser();
        const payload = Buffer.from('hello world');
        const dataUrl = `data:text/plain;base64,${payload.toString('base64')}`;

        const result = await callLoadFileInput(actor, dataUrl);

        expect(result.buffer.equals(payload)).toBe(true);
        expect(result.mimeType).toBe('text/plain');
        expect(result.fsEntry).toBeNull();
        // Filename derives from the MIME subtype.
        expect(result.filename).toBe('input.plain');
    });

    it('decodes a non-base64 (URL-encoded) data URL', async () => {
        const { actor } = await makeUser();
        // Plain (no `;base64`) → URL-decoded payload.
        const result = await callLoadFileInput(
            actor,
            'data:text/plain,hello%20world',
        );

        expect(result.buffer.toString('utf8')).toBe('hello world');
        expect(result.mimeType).toBe('text/plain');
    });

    it('infers MIME-derived filename for compound types like svg+xml', async () => {
        const { actor } = await makeUser();
        const result = await callLoadFileInput(
            actor,
            'data:image/svg+xml;base64,PHN2Zy8+',
        );
        // `image/svg+xml` → input.svg (subtype, before the `+`).
        expect(result.filename).toBe('input.svg');
        expect(result.mimeType).toBe('image/svg+xml');
    });

    it('defaults MIME to application/octet-stream when omitted', async () => {
        const { actor } = await makeUser();
        const result = await callLoadFileInput(actor, 'data:;base64,QUJD');
        expect(result.mimeType).toBe('application/octet-stream');
        expect(result.buffer.toString('utf8')).toBe('ABC');
    });

    it('throws 400 on a malformed data URL', async () => {
        const { actor } = await makeUser();
        // Missing comma → DATA_URL_PATTERN.exec returns null.
        await expect(
            callLoadFileInput(actor, 'data:not-a-url'),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects an oversize data URL with 413 + storage_limit_reached', async () => {
        const { actor } = await makeUser();
        const payload = Buffer.alloc(64);
        const dataUrl = `data:application/octet-stream;base64,${payload.toString('base64')}`;

        await expect(
            callLoadFileInput(actor, dataUrl, { maxBytes: 32 }),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'storage_limit_reached',
        });
    });

    it('accepts a data URL exactly at the maxBytes threshold', async () => {
        const { actor } = await makeUser();
        const payload = Buffer.alloc(16, 0x41); // 16 bytes of 'A'
        const dataUrl = `data:application/octet-stream;base64,${payload.toString('base64')}`;

        const result = await callLoadFileInput(actor, dataUrl, {
            maxBytes: 16,
        });
        expect(result.buffer.byteLength).toBe(16);
    });
});

// ── loadFileInput — FS path ─────────────────────────────────────────

describe('loadFileInput FS path', () => {
    it('reads bytes back through a real fsentry written via FSService', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/sample.txt`;
        const body = Buffer.from('hello from sql + s3');
        const entry = await withActor(actor, () =>
            writeFile(userId, path, body, 'text/plain'),
        );

        const result = await callLoadFileInput(actor, path);

        expect(result.buffer.equals(body)).toBe(true);
        expect(result.filename).toBe('sample.txt');
        // FSService stamps the contentType into S3 metadata; loadFileInput
        // returns it on the way out.
        expect(result.mimeType).toBe('text/plain');
        expect(result.fsEntry?.uuid).toBe(entry.uuid);
        expect(result.fsEntry?.path).toBe(path);
    });

    it('also accepts a `{ uuid }` object reference', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/by-uuid.bin`;
        const body = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const entry = await withActor(actor, () =>
            writeFile(userId, path, body),
        );

        const result = await callLoadFileInput(actor, { uuid: entry.uuid });
        expect(result.buffer.equals(body)).toBe(true);
        expect(result.fsEntry?.uuid).toBe(entry.uuid);
    });

    it('expands `~/...` paths against the actor home before resolving', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const body = Buffer.from('tilde');
        await withActor(actor, () =>
            writeFile(userId, `/${username}/Documents/tilde.txt`, body),
        );

        const result = await callLoadFileInput(actor, '~/Documents/tilde.txt');
        expect(result.buffer.equals(body)).toBe(true);
    });

    it('throws 404 when the fsentry cannot be resolved', async () => {
        const { actor } = await makeUser();
        await expect(
            callLoadFileInput(actor, {
                uuid: '00000000-0000-0000-0000-000000000000',
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects directory entries with 400', async () => {
        const { actor } = await makeUser();
        const username = actor.user!.username!;
        // The Documents folder is a real fsentry directory created by
        // generateDefaultFsentries.
        await expect(
            callLoadFileInput(actor, `/${username}/Documents`),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects when the FS access check denies the actor", async () => {
        // Owner writes a file; intruder tries to read it. The real
        // FSService.checkFSAccess walks the ACL and refuses.
        const owner = await makeUser();
        const intruder = await makeUser();
        const ownerName = owner.actor.user!.username!;
        const path = `/${ownerName}/Documents/private.txt`;
        await withActor(owner.actor, () =>
            writeFile(owner.userId, path, Buffer.from('owned')),
        );

        const err = await callLoadFileInput(intruder.actor, path).then(
            () => null,
            (e: unknown) => e,
        );
        const status = (err as { statusCode?: number } | null)?.statusCode;
        // Access denied lands as 403; "can't see" lands as 404 — both
        // are valid refusals from ACLService.getSafeAclError.
        expect([403, 404]).toContain(status);
    });

    it('rejects up-front when contentLength exceeds maxBytes', async () => {
        const { actor, userId } = await makeUser();
        const username = actor.user!.username!;
        const path = `/${username}/Documents/big.bin`;
        const body = Buffer.alloc(2048, 0x42);
        await withActor(actor, () =>
            writeFile(userId, path, body, 'application/octet-stream'),
        );

        await expect(
            callLoadFileInput(actor, path, { maxBytes: 64 }),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'storage_limit_reached',
        });
    });
});

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

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import {
    dataUriByteLength,
    isPuterFilePath,
    MAX_PUTER_IMAGE_INPUT_BYTES,
    MAX_PUTER_IMAGE_INPUTS,
    openVideoInput,
    readPuterImageInputs,
    signedPuterVideoUrl,
    type VideoInputStream,
} from './mediaInput.js';

// Web inputs leave the process through secureFetch; the tests control it.
const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));
vi.mock('../../util/secureHttp.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util/secureHttp.js')>()),
    secureFetch: secureFetchMock,
}));

// A 1x1 PNG, a JPEG head, and the head of an MP4 (`ftyp` box, `isom` brand).
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom', 'latin1'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2', 'latin1'),
    Buffer.from('mdat-frames', 'latin1'),
]);

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    secureFetchMock.mockReset();
    vi.restoreAllMocks();
});

const deps = () => ({ stores: server.stores, fs: server.services.fs });

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `media-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 200 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const user = (await server.stores.user.getById(created.id))!;
    return {
        userId: user.id,
        actor: {
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
                email: user.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

const writeFile = async (
    { actor, userId }: { actor: Actor; userId: number },
    name: string,
    body: Buffer,
): Promise<string> => {
    const path = `/${actor.user.username}/${name}`;
    await server.services.fs.write(userId, {
        fileMetadata: {
            path,
            size: body.byteLength,
            contentType: 'application/octet-stream',
        },
        fileContent: body,
    });
    return path;
};

const statusOf = async (promise: Promise<unknown>): Promise<number | null> =>
    promise.then(
        () => null,
        (err: { statusCode?: number }) => err.statusCode ?? null,
    );

const readAll = async (video: VideoInputStream): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of video.chunks) chunks.push(chunk);
    return Buffer.concat(chunks);
};

/** A body that pulls chunks on demand and records whether it was cancelled. */
const chunkedBody = (chunks: Buffer[]) => {
    const state = { pulls: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            const chunk = chunks[state.pulls++];
            if (chunk) controller.enqueue(new Uint8Array(chunk));
            else controller.close();
        },
        cancel() {
            state.cancelled = true;
        },
    });
    return { body, state };
};

describe('isPuterFilePath', () => {
    it('reads absolute and home-relative paths as Puter files', () => {
        expect(isPuterFilePath('/alice/AppData/app/.tmp/a.tmp')).toBe(true);
        expect(isPuterFilePath('~/Videos/dog.mp4')).toBe(true);
    });

    it('leaves URLs, data URIs, raw base64 images and relative names alone', () => {
        for (const value of [
            'https://example.com/a.png',
            `data:image/png;base64,${PNG_BASE64}`,
            PNG_BASE64,
            Buffer.concat([JPEG, Buffer.alloc(3)]).toString('base64'),
            'Videos/dog.mp4',
            42,
        ]) {
            expect(isPuterFilePath(value)).toBe(false);
        }
        // Only the head is decoded, so the rest of a large input isn't read.
        const jpegHead = Buffer.concat([JPEG, Buffer.alloc(9)]).toString(
            'base64',
        );
        expect(isPuterFilePath(`${jpegHead}not base64 after the head`)).toBe(
            false,
        );
        // A raw JPEG's base64 starts like an absolute path.
        expect(
            Buffer.concat([JPEG, Buffer.alloc(3)]).toString('base64'),
        ).toMatch(/^\//);
    });
});

describe('dataUriByteLength', () => {
    it('estimates decoded bytes without parsing the payload', () => {
        const bytes = Buffer.alloc(3000, 7);
        expect(
            dataUriByteLength(
                `data:video/mp4;base64,${bytes.toString('base64')}`,
            ),
        ).toBe(3000);
        expect(dataUriByteLength('data:text/plain,hello')).toBe(5);
        expect(dataUriByteLength('no comma')).toBe(0);
    });
});

describe('readPuterImageInputs', () => {
    it("returns the caller's own image files as data URIs keyed by path", async () => {
        const user = await makeUser();
        const png = await writeFile(user, 'a.png.tmp', PNG);
        const jpeg = await writeFile(user, 'b.tmp', JPEG);

        const inlined = await readPuterImageInputs(deps(), user.actor, [
            png,
            'https://example.com/c.png',
            jpeg,
            png,
            undefined,
        ]);

        expect([...inlined.keys()]).toEqual([png, jpeg]);
        expect(inlined.get(png)).toBe(`data:image/png;base64,${PNG_BASE64}`);
        expect(inlined.get(jpeg)).toBe(
            `data:image/jpeg;base64,${JPEG.toString('base64')}`,
        );
        expect(secureFetchMock).not.toHaveBeenCalled();
    });

    it('reads nothing when no input is a path', async () => {
        const { actor } = await makeUser();
        const inlined = await readPuterImageInputs(deps(), actor, [
            PNG_BASE64,
            'https://example.com/a.png',
        ]);
        expect(inlined.size).toBe(0);
    });

    it("refuses another user's file", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const path = await writeFile(owner, 'private.png', PNG);
        expect([403, 404]).toContain(
            await statusOf(
                readPuterImageInputs(deps(), intruder.actor, [path]),
            ),
        );
    });

    it('refuses a file that is not a PNG, JPEG, WebP or GIF image', async () => {
        const user = await makeUser();
        const path = await writeFile(user, 'clip.tmp', MP4);
        await expect(
            readPuterImageInputs(deps(), user.actor, [path]),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Image inputs must be PNG, JPEG, WebP or GIF images',
        });
    });

    it('refuses files over the combined size before reading any', async () => {
        const user = await makeUser();
        const half = Buffer.alloc(MAX_PUTER_IMAGE_INPUT_BYTES / 2 + 1);
        PNG.copy(half);
        const a = await writeFile(user, 'a.png', half);
        const b = await writeFile(user, 'b.png', half);
        const read = vi.spyOn(server.stores.s3Object, 'getObjectStream');

        await expect(
            readPuterImageInputs(deps(), user.actor, [a, b]),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'input_too_large',
        });
        expect(read).not.toHaveBeenCalled();
    });

    it(`refuses more than ${MAX_PUTER_IMAGE_INPUTS} paths`, async () => {
        const { actor } = await makeUser();
        const paths = Array.from(
            { length: MAX_PUTER_IMAGE_INPUTS + 1 },
            (_, i) => `/someone/${i}.png`,
        );
        await expect(
            readPuterImageInputs(deps(), actor, paths),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('signedPuterVideoUrl', () => {
    const options = { maxBytes: 1024, expiresInSeconds: 900 };

    it("signs a short-lived URL to the caller's own video, typed by its bytes", async () => {
        const user = await makeUser();
        const path = await writeFile(user, 'dog.tmp', MP4);

        const url = await signedPuterVideoUrl(
            deps(),
            user.actor,
            path,
            options,
        );

        const params = new URL(url).searchParams;
        expect(params.get('X-Amz-Expires')).toBe('900');
        expect(params.get('response-content-type')).toBe('video/mp4');
        const response = await fetch(url);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(MP4);
    });

    it('refuses an image, an empty file and a file over maxBytes', async () => {
        const user = await makeUser();
        const image = await writeFile(user, 'a.png', PNG);
        const empty = await writeFile(user, 'empty.mp4', Buffer.alloc(0));
        const big = Buffer.alloc(options.maxBytes + 1);
        MP4.copy(big);
        const large = await writeFile(user, 'big.mp4', big);

        for (const path of [image, empty]) {
            await expect(
                signedPuterVideoUrl(deps(), user.actor, path, options),
            ).rejects.toMatchObject({
                statusCode: 400,
                message:
                    'input_video must be an MP4, QuickTime, WebM or Matroska video',
            });
        }
        await expect(
            signedPuterVideoUrl(deps(), user.actor, large, options),
        ).rejects.toMatchObject({ statusCode: 413 });
    });

    it("refuses another user's file", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const path = await writeFile(owner, 'private.mp4', MP4);
        expect([403, 404]).toContain(
            await statusOf(
                signedPuterVideoUrl(deps(), intruder.actor, path, options),
            ),
        );
    });
});

describe('openVideoInput', () => {
    const options = { maxBytes: 1024, timeoutMs: 60_000 };
    const open = (actor: Actor, input: string, extra = {}) =>
        openVideoInput(deps(), actor, input, { ...options, ...extra });

    it('decodes a data URI and sniffs its type', async () => {
        const { actor } = await makeUser();
        const video = await open(
            actor,
            `data:video/mp4;base64,${MP4.toString('base64')}`,
        );
        expect(video.mimeType).toBe('video/mp4');
        expect(video.byteLength).toBe(MP4.byteLength);
        expect(await readAll(video)).toEqual(MP4);
    });

    it('refuses a data URI over maxBytes', async () => {
        const { actor } = await makeUser();
        const big = Buffer.alloc(options.maxBytes + 3).toString('base64');
        await expect(
            open(actor, `data:video/mp4;base64,${big}`),
        ).rejects.toMatchObject({ statusCode: 413 });
    });

    it('streams a web URL of declared length without buffering it', async () => {
        const { actor } = await makeUser();
        const chunks = [
            MP4,
            ...Array.from({ length: 63 }, () => Buffer.alloc(1024)),
        ];
        const clip = Buffer.concat(chunks);
        const { body, state } = chunkedBody(chunks);
        secureFetchMock.mockResolvedValueOnce(
            new Response(body, {
                headers: { 'content-length': String(clip.byteLength) },
            }),
        );

        const video = await open(actor, 'https://example.com/dog.mp4', {
            maxBytes: clip.byteLength,
        });
        expect(video.mimeType).toBe('video/mp4');
        expect(video.byteLength).toBe(clip.byteLength);
        // Sniffing the type reads ahead a little, not the whole body.
        expect(state.pulls).toBeLessThan(chunks.length);
        expect(await readAll(video)).toEqual(clip);
        expect(secureFetchMock).toHaveBeenCalledWith(
            'https://example.com/dog.mp4',
            { signal: expect.any(AbortSignal) },
        );
    });

    it('buffers a web URL with no usable length, within maxBytes', async () => {
        const { actor } = await makeUser();
        secureFetchMock.mockResolvedValueOnce(
            new Response(chunkedBody([MP4]).body),
        );
        const video = await open(actor, 'https://example.com/dog.mp4');
        expect(video.byteLength).toBe(MP4.byteLength);
        expect(await readAll(video)).toEqual(MP4);

        secureFetchMock.mockResolvedValueOnce(
            new Response(MP4, {
                headers: {
                    'content-length': '5',
                    'content-encoding': 'gzip',
                },
            }),
        );
        expect(
            (await open(actor, 'https://example.com/dog.mp4')).byteLength,
        ).toBe(MP4.byteLength);

        secureFetchMock.mockResolvedValueOnce(
            new Response(
                chunkedBody([Buffer.alloc(options.maxBytes + 1)]).body,
            ),
        );
        await expect(
            open(actor, 'https://example.com/big.mp4'),
        ).rejects.toMatchObject({ statusCode: 413 });
    });

    it('refuses a declared length over maxBytes without reading the body', async () => {
        const { actor } = await makeUser();
        const { body, state } = chunkedBody([MP4]);
        secureFetchMock.mockResolvedValueOnce(
            new Response(body, {
                headers: { 'content-length': String(options.maxBytes + 1) },
            }),
        );
        await expect(
            open(actor, 'https://example.com/big.mp4'),
        ).rejects.toMatchObject({ statusCode: 413 });
        expect(state.cancelled).toBe(true);
    });

    it('cancels the body of a failed response', async () => {
        const { actor } = await makeUser();
        const { body, state } = chunkedBody([Buffer.alloc(32)]);
        secureFetchMock.mockResolvedValueOnce(
            new Response(body, { status: 404 }),
        );
        await expect(
            open(actor, 'https://example.com/missing.mp4'),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Failed to fetch input_video (status 404)',
        });
        expect(state.cancelled).toBe(true);
    });

    it('reports a body that fails while the type is read as a 400', async () => {
        const { actor } = await makeUser();
        secureFetchMock.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    pull(controller) {
                        controller.error(new Error('connection reset'));
                    },
                }),
                { headers: { 'content-length': '512' } },
            ),
        );
        await expect(
            open(actor, 'https://example.com/dog.mp4'),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Failed to fetch input_video',
        });
    });

    it('rejects a pre-aborted caller before fetching', async () => {
        const { actor } = await makeUser();
        const abort = new AbortController();
        abort.abort();
        await expect(
            open(actor, 'https://example.com/dog.mp4', {
                signal: abort.signal,
            }),
        ).rejects.toBe(abort.signal.reason);
        expect(secureFetchMock).not.toHaveBeenCalled();
    });

    it("keeps the caller's abort reason and reports its own timeout as a 400", async () => {
        const { actor } = await makeUser();
        const pending = (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
                init.signal.addEventListener(
                    'abort',
                    () => reject(init.signal.reason),
                    { once: true },
                );
            });

        const abort = new AbortController();
        const reason = new DOMException('Caller left', 'AbortError');
        secureFetchMock.mockImplementationOnce((url, init) => {
            const result = pending(url, init);
            abort.abort(reason);
            return result;
        });
        await expect(
            open(actor, 'https://example.com/dog.mp4', {
                signal: abort.signal,
            }),
        ).rejects.toBe(reason);

        secureFetchMock.mockImplementationOnce(pending);
        await expect(
            open(actor, 'https://example.com/dog.mp4', { timeoutMs: 10 }),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Timed out fetching input_video after 10 ms',
        });
    });

    it("streams the caller's own Puter file at its stored length", async () => {
        const user = await makeUser();
        const path = await writeFile(user, 'dog.tmp', MP4);
        const video = await open(user.actor, path);
        expect(video.mimeType).toBe('video/mp4');
        expect(video.byteLength).toBe(MP4.byteLength);
        expect(await readAll(video)).toEqual(MP4);
    });

    it('reports a null type for bytes that are not a video', async () => {
        const user = await makeUser();
        const path = await writeFile(user, 'a.png', PNG);
        const video = await open(user.actor, path);
        expect(video.mimeType).toBeNull();
        video.cancel();
    });

    it("refuses another user's Puter file and one over maxBytes", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const path = await writeFile(owner, 'private.mp4', MP4);
        expect([403, 404]).toContain(
            await statusOf(open(intruder.actor, path)),
        );

        const big = Buffer.alloc(options.maxBytes + 1);
        const large = await writeFile(owner, 'big.mp4', big);
        expect(await statusOf(open(owner.actor, large))).toBe(413);
    });
});

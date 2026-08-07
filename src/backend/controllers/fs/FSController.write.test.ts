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

import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSController } from './FSController.js';
import type {
    ClientSignedWriteResponse,
    CompleteWriteRequest,
    SignedWriteRequest,
    WriteRequest,
} from './requestTypes.js';
import type { AbortWriteRequest, SignMultipartPartsRequest } from './types.js';

// The write-side of `/fs/*`: `/write`, `/batchWrite` (JSON and multipart),
// `/startWrite` + `/completeWrite` + `/abortWrite` + `/signMultipartParts`.
// Driven against a real in-memory server so the S3 object store, the pending
// session rows and the storage-allowance checks are all live.

let server: PuterServer;
let controller: FSController;

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.fs as unknown as FSController;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (
    extra?: Record<string, unknown>,
    freeStorage = 100 * 1024 * 1024,
): Promise<{ actor: Actor; userId: number; username: string }> => {
    const username = `fsw-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: freeStorage,
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
        username: refreshed.username,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
                ...extra,
            } as Actor['user'],
        },
    };
};

interface CapturedResponse {
    statusCode: number;
    body: unknown;
}

const makeReq = <B>(init: {
    body?: B;
    headers?: Record<string, string>;
    actor: Actor;
    withUser?: boolean;
}): Request =>
    ({
        body: init.body ?? ({} as B),
        query: {},
        headers: init.headers ?? { 'content-type': 'application/json' },
        actor: init.actor,
        ...(init.withUser === false
            ? {}
            : {
                  user: {
                      id: init.actor.user!.id!,
                      username: init.actor.user!.username!,
                  },
              }),
    }) as unknown as Request;

const makeRes = () => {
    const captured: CapturedResponse = { statusCode: 200, body: undefined };
    const res = {
        json: vi.fn((value: unknown) => {
            captured.body = value;
            return res;
        }),
        status: vi.fn((code: number) => {
            captured.statusCode = code;
            return res;
        }),
        setHeader: vi.fn(() => res),
    };
    return { res: res as unknown as Response, captured };
};

const withActor = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runWithContext({ actor }, fn);

// -- multipart request builder ---------------------------------------
//
// `/fs/batchWrite` in multipart mode reads the raw request stream with
// busboy, so the fake request has to be a real Readable carrying multipart
// bytes and a matching boundary header.

type MultipartPart =
    | { kind: 'field'; name: string; value: string }
    | { kind: 'file'; name: string; filename: string; content: string };

const BOUNDARY = 'puter-test-boundary';

const buildMultipartBody = (parts: MultipartPart[]): Buffer => {
    const chunks: string[] = [];
    for (const part of parts) {
        chunks.push(`--${BOUNDARY}\r\n`);
        if (part.kind === 'field') {
            chunks.push(
                `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`,
            );
            chunks.push(`${part.value}\r\n`);
        } else {
            chunks.push(
                `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
            );
            chunks.push('Content-Type: application/octet-stream\r\n\r\n');
            chunks.push(`${part.content}\r\n`);
        }
    }
    chunks.push(`--${BOUNDARY}--\r\n`);
    return Buffer.from(chunks.join(''), 'utf8');
};

const makeMultipartReq = (parts: MultipartPart[], actor: Actor): Request => {
    const stream = Readable.from([buildMultipartBody(parts)]);
    return Object.assign(stream, {
        body: undefined,
        query: {},
        headers: {
            'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        },
        actor,
        user: { id: actor.user!.id!, username: actor.user!.username! },
    }) as unknown as Request;
};

// -- /fs/write --------------------------------------------------------

describe('FSController.write', () => {
    it('writes file content and returns a sanitized fsEntry', async () => {
        const { actor, userId, username } = await makeUser();
        const target = `/${username}/Documents/write-basic.txt`;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: {
                            path: target,
                            size: 5,
                            contentType: 'text/plain',
                        },
                        fileContent: 'hello',
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );

        const body = captured.body as {
            wasOverwrite: boolean;
            fsEntry: Record<string, unknown>;
        };
        expect(body.wasOverwrite).toBe(false);
        expect(body.fsEntry.path).toBe(target);
        expect(body.fsEntry.isDir).toBe(false);
        for (const field of [
            'id',
            'userId',
            'parentId',
            'bucket',
            'bucketRegion',
            'objectKey',
            'publicToken',
            'fileRequestToken',
        ]) {
            expect(body.fsEntry).not.toHaveProperty(field);
        }

        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.userId).toBe(userId);
        expect(stored?.size).toBe(5);
    });

    it('reports wasOverwrite and updates the row when overwriting', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/write-overwrite.txt`;
        const write = (content: string, overwrite: boolean) =>
            withActor(actor, () => {
                const { res, captured } = makeRes();
                return controller
                    .write(
                        makeReq<WriteRequest>({
                            body: {
                                fileMetadata: {
                                    path: target,
                                    size: content.length,
                                    overwrite,
                                },
                                fileContent: content,
                            } as WriteRequest,
                            actor,
                        }),
                        res,
                    )
                    .then(() => captured.body as { wasOverwrite: boolean });
            });

        expect((await write('one', false)).wasOverwrite).toBe(false);
        expect((await write('second', true)).wasOverwrite).toBe(true);
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.size).toBe(6);
    });

    it('decodes base64 file content when `encoding` says so', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/write-b64.bin`;
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: { path: target, size: 3 },
                        fileContent: Buffer.from('abc').toString('base64'),
                        encoding: 'base64',
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.size).toBe(3);
    });

    it('persists a thumbnail supplied inline with the write', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/write-thumb.txt`;
        const thumbnail = 'data:image/png;base64,aGVsbG8=';
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: { path: target, size: 2 },
                        fileContent: 'hi',
                        thumbnailData: thumbnail,
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.thumbnail).toBe(thumbnail);
    });

    it('drops an oversized inline thumbnail instead of storing it', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/write-big-thumb.txt`;
        // 3 MiB of base64 payload — over the 2 MiB thumbnail cap.
        const oversized = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: { path: target, size: 2 },
                        fileContent: 'hi',
                        thumbnailData: oversized,
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.thumbnail).toBeNull();
    });

    it('skips thumbnails for AppData paths', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/AppData/some-app/write-thumb.txt`;
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: {
                            path: target,
                            size: 2,
                            createMissingParents: true,
                        },
                        fileContent: 'hi',
                        thumbnailData: 'data:image/png;base64,aGVsbG8=',
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.thumbnail).toBeNull();
    });

    it('rejects a write with no path', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: {},
                            fileContent: 'x',
                        } as unknown as WriteRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
    });

    it('rejects a blank path with `Path cannot be empty`', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: { path: '   ' },
                            fileContent: 'x',
                        } as unknown as WriteRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Path cannot be empty',
        });
    });

    it('rejects a non-normalized path containing `..`', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${username}/Documents/../../etc/passwd`,
                            },
                            fileContent: 'x',
                        } as unknown as WriteRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid path' });
    });

    it('rejects a write whose parent is the root with `cannot_write_to_root`', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: { path: '/top-level.txt' },
                            fileContent: 'x',
                        } as unknown as WriteRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'cannot_write_to_root',
        });
    });

    it('rejects a write to the root path itself', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: { path: '/' },
                            fileContent: 'x',
                        } as unknown as WriteRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'cannot_write_to_root',
        });
    });

    it("masks a write into another user's home as 404 subject_does_not_exist", async () => {
        const attacker = await makeUser();
        const victim = await makeUser();
        const { res } = makeRes();
        // The denial must not confirm that the victim's directory exists —
        // the ACL layer downgrades "forbidden" to "does not exist" whenever
        // the caller cannot even `see` the path.
        await expect(
            withActor(attacker.actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${victim.username}/Documents/intruder.txt`,
                                size: 1,
                            },
                            fileContent: 'x',
                        } as WriteRequest,
                        actor: attacker.actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${victim.username}/Documents/intruder.txt`,
            ),
        ).toBeNull();
    });

    it('throws 401 when the request carries no user identity', async () => {
        const { res } = makeRes();
        const actor = { user: {} } as Actor;
        await expect(
            withActor(actor, () =>
                controller.write(
                    makeReq<WriteRequest>({
                        body: {
                            fileMetadata: { path: '/x/y.txt' },
                            fileContent: 'x',
                        } as unknown as WriteRequest,
                        actor,
                        withUser: false,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 401,
            legacyCode: 'unauthorized',
        });
    });

    it('trims a trailing slash and accepts a relative path', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        // No leading slash, trailing slash: both normalized.
                        fileMetadata: {
                            path: `${username}/Documents/relative.txt/`,
                            size: 1,
                        },
                        fileContent: 'x',
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        expect(
            (captured.body as { fsEntry: { path: string } }).fsEntry.path,
        ).toBe(`/${username}/Documents/relative.txt`);
    });
});

// -- storage allowance -------------------------------------------------
//
// Quota enforcement is off in the default test config (`is_storage_limited`
// false makes the ceiling free disk space), so this group runs its own
// server with the limit switched on.

describe('FSController.write storage allowance', () => {
    let limitedServer: PuterServer;
    let limitedController: FSController;

    beforeAll(async () => {
        limitedServer = await setupTestServer({
            is_storage_limited: true,
        } as never);
        limitedController = limitedServer.controllers
            .fs as unknown as FSController;
    });

    afterAll(async () => {
        await limitedServer?.shutdown();
    });

    const makeLimitedUser = async (extra?: Record<string, unknown>) => {
        const username = `fsq-${Math.random().toString(36).slice(2, 10)}`;
        const created = await limitedServer.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 16,
            requires_email_confirmation: false,
        });
        await generateDefaultFsentries(
            limitedServer.clients.db,
            limitedServer.stores.user,
            created,
        );
        const refreshed = (await limitedServer.stores.user.getById(
            created.id,
        ))!;
        return {
            username: refreshed.username,
            actor: {
                user: {
                    id: refreshed.id,
                    uuid: refreshed.uuid,
                    username: refreshed.username,
                    email: refreshed.email ?? null,
                    email_confirmed: true,
                    ...extra,
                } as Actor['user'],
            } as Actor,
        };
    };

    const writeSixtyFourBytes = (actor: Actor, path: string) => {
        const { res } = makeRes();
        return withActor(actor, () =>
            limitedController.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: { path, size: 64 },
                        fileContent: 'x'.repeat(64),
                    } as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
    };

    it('rejects a write over the stored allowance with 413 storage_limit_reached', async () => {
        const { actor, username } = await makeLimitedUser();
        await expect(
            writeSixtyFourBytes(actor, `/${username}/Documents/too-big.bin`),
        ).rejects.toMatchObject({
            statusCode: 413,
            legacyCode: 'storage_limit_reached',
        });
    });

    it('lifts the ceiling when the actor carries a larger live allowance', async () => {
        // `#getStorageAllowanceMaxOverride` takes the larger of the actor's
        // `free_storage` / `actual_free_storage` fields; a live grant on the
        // actor beats the smaller value stored on the user row.
        const { actor, username } = await makeLimitedUser({
            actual_free_storage: 1024 * 1024,
        });
        const target = `/${username}/Documents/allowed-by-override.bin`;
        await writeSixtyFourBytes(actor, target);
        expect(
            (await limitedServer.stores.fsEntry.getEntryByPath(target))?.size,
        ).toBe(64);
    });

    it('ignores a negative live allowance and keeps the stored ceiling', async () => {
        const { actor, username } = await makeLimitedUser({
            free_storage: -1,
        });
        await expect(
            writeSixtyFourBytes(actor, `/${username}/Documents/negative.bin`),
        ).rejects.toMatchObject({ statusCode: 413 });
    });
});

// -- /fs/startWrite ---------------------------------------------------

describe('FSController.startWrite', () => {
    it('creates a pending session and hides storage internals', async () => {
        const { actor, userId, username } = await makeUser();
        const target = `/${username}/Documents/signed-single.bin`;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.startWrite(
                makeReq<SignedWriteRequest>({
                    body: { fileMetadata: { path: target, size: 9 } },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as ClientSignedWriteResponse;
        expect(body.sessionId).toEqual(expect.any(String));
        expect(body.uploadMode).toBe('single');
        for (const field of ['bucket', 'bucketRegion', 'objectKey']) {
            expect(body).not.toHaveProperty(field);
        }
        const session = await server.stores.fsEntry.getPendingEntryBySessionId(
            body.sessionId,
        );
        expect(session?.targetPath).toBe(target);
        expect(session?.userId).toBe(userId);
    });

    it('emits a pending GUI event carrying the operation id', async () => {
        const { actor, userId, username } = await makeUser();
        const events: Array<Record<string, unknown>> = [];
        const listener = (_key: string, data: unknown) => {
            events.push(data as Record<string, unknown>);
        };
        server.clients.event.on('outer.gui.item.pending', listener as never);
        try {
            const { res } = makeRes();
            await withActor(actor, () =>
                controller.startWrite(
                    makeReq<SignedWriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${username}/Documents/pending.bin`,
                                size: 3,
                            },
                            guiMetadata: { operationId: 'op-1' },
                        },
                        actor,
                    }),
                    res,
                ),
            );
        } finally {
            server.clients.event.off(
                'outer.gui.item.pending',
                listener as never,
            );
        }
        expect(events).toHaveLength(1);
        const payload = events[0] as {
            user_id_list: number[];
            response: Record<string, unknown>;
        };
        expect(payload.user_id_list).toEqual([userId]);
        expect(payload.response.pending_upload).toBe(true);
        expect(payload.response.operation_id).toBe('op-1');
        expect(payload.response.status).toBe('pending');
    });

    it('creates a real directory entry (and no session) for `directory: true`', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/signed-dir`;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.startWrite(
                makeReq<SignedWriteRequest>({
                    body: {
                        fileMetadata: {
                            path: target,
                            size: 0,
                            createMissingParents: true,
                        },
                        directory: true,
                    },
                    actor,
                }),
                res,
            ),
        );
        const created = await server.stores.fsEntry.getEntryByPath(target);
        expect(created?.isDir).toBe(true);
        expect(captured.body).not.toHaveProperty('objectKey');
    });

    it('attaches signed thumbnail upload targets published by a listener', async () => {
        const { actor, username } = await makeUser();
        const listener = (_key: string, data: unknown) => {
            const payload = data as {
                items: Array<{
                    index: number;
                    uploadUrl?: string;
                    thumbnailUrl?: string;
                }>;
            };
            for (const item of payload.items) {
                item.uploadUrl = `https://thumbs.test/put/${item.index}`;
                item.thumbnailUrl = `https://thumbs.test/get/${item.index}`;
            }
        };
        server.clients.event.on('thumbnail.upload.prepare', listener as never);
        try {
            const { res, captured } = makeRes();
            await withActor(actor, () =>
                controller.startWrite(
                    makeReq<SignedWriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${username}/Documents/thumbed.bin`,
                                size: 4,
                            },
                            thumbnailMetadata: {
                                contentType: 'image/png',
                                size: 128,
                            },
                        },
                        actor,
                    }),
                    res,
                ),
            );
            const body = captured.body as ClientSignedWriteResponse;
            expect(body.thumbnailUploadUrl).toBe('https://thumbs.test/put/0');
            expect(body.thumbnailUrl).toBe('https://thumbs.test/get/0');
        } finally {
            server.clients.event.off(
                'thumbnail.upload.prepare',
                listener as never,
            );
        }
    });

    it('rejects thumbnailMetadata with a blank contentType', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.startWrite(
                    makeReq<SignedWriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${username}/Documents/bad-thumb.bin`,
                                size: 1,
                            },
                            thumbnailMetadata: {
                                contentType: '   ',
                            } as unknown as SignedWriteRequest['thumbnailMetadata'],
                        },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('thumbnailMetadata.contentType'),
        });
    });

    it('rejects a negative thumbnailMetadata size', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.startWrite(
                    makeReq<SignedWriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${username}/Documents/bad-thumb2.bin`,
                                size: 1,
                            },
                            thumbnailMetadata: {
                                contentType: 'image/png',
                                size: -1,
                            },
                        },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('thumbnailMetadata.size'),
        });
    });

    it('skips signed thumbnail preparation when the declared size is over the cap', async () => {
        const { actor, username } = await makeUser();
        const prepared: unknown[] = [];
        const listener = (_key: string, data: unknown) => {
            prepared.push(data);
        };
        server.clients.event.on('thumbnail.upload.prepare', listener as never);
        try {
            const { res, captured } = makeRes();
            await withActor(actor, () =>
                controller.startWrite(
                    makeReq<SignedWriteRequest>({
                        body: {
                            fileMetadata: {
                                path: `/${username}/Documents/huge-thumb.bin`,
                                size: 1,
                            },
                            thumbnailMetadata: {
                                contentType: 'image/png',
                                size: 8 * 1024 * 1024,
                            },
                        },
                        actor,
                    }),
                    res,
                ),
            );
            expect(prepared).toHaveLength(0);
            expect(captured.body).not.toHaveProperty('thumbnailUploadUrl');
        } finally {
            server.clients.event.off(
                'thumbnail.upload.prepare',
                listener as never,
            );
        }
    });

    it('resolves a client-supplied appUID to the numeric associatedAppId', async () => {
        const { actor, username } = await makeUser();
        const appUid = `app-${uuidv4()}`;
        await server.clients.db.write(
            `INSERT INTO \`apps\` (\`uid\`, \`name\`, \`title\`, \`index_url\`, \`owner_user_id\`, \`is_private\`)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [appUid, appUid, 'Assoc App', 'https://assoc.test/', null, 0],
        );
        const [appRow] = (await server.clients.db.read(
            'SELECT id FROM apps WHERE uid = ?',
            [appUid],
        )) as Array<{ id: number }>;

        const target = `/${username}/Documents/assoc.txt`;
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: { path: target, size: 1 },
                        fileContent: 'x',
                        appUID: appUid,
                    } as unknown as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.associatedAppId).toBe(appRow!.id);
    });

    it('drops an appUID that does not resolve to a known app', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/unknown-app.txt`;
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.write(
                makeReq<WriteRequest>({
                    body: {
                        fileMetadata: { path: target, size: 1 },
                        fileContent: 'x',
                        appUID: `app-${uuidv4()}`,
                    } as unknown as WriteRequest,
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(target);
        expect(stored?.associatedAppId).toBeNull();
    });
});

// -- /fs/completeWrite, /fs/abortWrite, /fs/signMultipartParts --------

describe('FSController.completeWrite', () => {
    const startSignedWrite = async (
        actor: Actor,
        path: string,
        size: number,
        extra: Partial<SignedWriteRequest> = {},
    ) => {
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.startWrite(
                makeReq<SignedWriteRequest>({
                    body: { fileMetadata: { path, size }, ...extra },
                    actor,
                }),
                res,
            ),
        );
        return captured.body as ClientSignedWriteResponse;
    };

    it('finalizes a pending session into a real fsentry', async () => {
        const { actor, username } = await makeUser();
        const target = `/${username}/Documents/complete-single.txt`;
        const started = await startSignedWrite(actor, target, 4);

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.completeWrite(
                makeReq<CompleteWriteRequest>({
                    body: { uploadId: started.sessionId },
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as {
            wasOverwrite: boolean;
            fsEntry: Record<string, unknown>;
        };
        expect(body.fsEntry.path).toBe(target);
        expect(body.wasOverwrite).toBe(false);
        expect(body.fsEntry).not.toHaveProperty('userId');
        expect(
            await server.stores.fsEntry.getEntryByPath(target),
        ).not.toBeNull();
    });

    it('rejects an inline `data:` thumbnail on the signed completion path', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.completeWrite(
                    makeReq<CompleteWriteRequest>({
                        body: {
                            uploadId: 'irrelevant',
                            thumbnailData: 'data:image/png;base64,AAA',
                        },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('accepts a non-inline thumbnail URL on completion', async () => {
        const { actor, username } = await makeUser();
        const started = await startSignedWrite(
            actor,
            `/${username}/Documents/complete-thumb.txt`,
            2,
        );
        const { res } = makeRes();
        await withActor(actor, () =>
            controller.completeWrite(
                makeReq<CompleteWriteRequest>({
                    body: {
                        uploadId: started.sessionId,
                        thumbnailData: 'https://thumbs.test/x.png',
                    },
                    actor,
                }),
                res,
            ),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(
            `/${username}/Documents/complete-thumb.txt`,
        );
        expect(stored?.thumbnail).toBe('https://thumbs.test/x.png');
    });

    it('404s an unknown upload id', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.completeWrite(
                    makeReq<CompleteWriteRequest>({
                        body: { uploadId: uuidv4() },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('FSController.abortWrite', () => {
    it('rejects a request with no uploadId', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.abortWrite(
                    makeReq<AbortWriteRequest>({
                        body: {} as AbortWriteRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
    });

    it('drops the pending session and answers {ok: true}', async () => {
        const { actor, username } = await makeUser();
        const start = makeRes();
        await withActor(actor, () =>
            controller.startWrite(
                makeReq<SignedWriteRequest>({
                    body: {
                        fileMetadata: {
                            path: `/${username}/Documents/aborted.bin`,
                            size: 3,
                        },
                    },
                    actor,
                }),
                start.res,
            ),
        );
        const { sessionId } = start.captured.body as ClientSignedWriteResponse;

        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.abortWrite(
                makeReq<AbortWriteRequest>({
                    body: { uploadId: sessionId },
                    actor,
                }),
                res,
            ),
        );
        expect(captured.body).toEqual({ ok: true });
        const session =
            await server.stores.fsEntry.getPendingEntryBySessionId(sessionId);
        expect(session?.status).toBe('aborted');
    });

    it("refuses to abort another user's upload session", async () => {
        const owner = await makeUser();
        const attacker = await makeUser();
        const start = makeRes();
        await withActor(owner.actor, () =>
            controller.startWrite(
                makeReq<SignedWriteRequest>({
                    body: {
                        fileMetadata: {
                            path: `/${owner.username}/Documents/not-yours.bin`,
                            size: 3,
                        },
                    },
                    actor: owner.actor,
                }),
                start.res,
            ),
        );
        const { sessionId } = start.captured.body as ClientSignedWriteResponse;

        const { res } = makeRes();
        await expect(
            withActor(attacker.actor, () =>
                controller.abortWrite(
                    makeReq<AbortWriteRequest>({
                        body: { uploadId: sessionId },
                        actor: attacker.actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('FSController.signMultipartParts', () => {
    it('rejects a request with no uploadId', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.signMultipartParts(
                    makeReq<SignMultipartPartsRequest>({
                        body: {} as SignMultipartPartsRequest,
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('404s a session that does not exist', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.signMultipartParts(
                    makeReq<SignMultipartPartsRequest>({
                        body: { uploadId: uuidv4(), partNumbers: [1, 2] },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// -- /fs/batchWrite (JSON mode) ---------------------------------------

describe('FSController.batchWrites (json)', () => {
    it('writes every item and returns one sanitized entry per request', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeReq<WriteRequest[]>({
                    body: [
                        {
                            fileMetadata: {
                                path: `/${username}/Documents/batch-a.txt`,
                                size: 1,
                            },
                            fileContent: 'a',
                        },
                        {
                            fileMetadata: {
                                path: `/${username}/Documents/batch-b.txt`,
                                size: 2,
                            },
                            fileContent: 'bb',
                        },
                    ] as WriteRequest[],
                    actor,
                }),
                res,
            ),
        );
        const body = captured.body as Array<{
            fsEntry: Record<string, unknown>;
        }>;
        expect(body.map((r) => r.fsEntry.path).sort()).toEqual([
            `/${username}/Documents/batch-a.txt`,
            `/${username}/Documents/batch-b.txt`,
        ]);
        for (const item of body) {
            expect(item.fsEntry).not.toHaveProperty('bucket');
        }
    });

    it('returns [] for a non-array body', async () => {
        const { actor } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeReq<WriteRequest[]>({
                    body: undefined,
                    actor,
                }),
                res,
            ),
        );
        expect(captured.body).toEqual([]);
    });

    it('silently drops .DS_Store items and writes nothing', async () => {
        const { actor, username } = await makeUser();
        const junkPath = `/${username}/Documents/.DS_Store`;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeReq<WriteRequest[]>({
                    body: [
                        {
                            fileMetadata: { path: junkPath, size: 1 },
                            fileContent: 'x',
                        },
                    ] as WriteRequest[],
                    actor,
                }),
                res,
            ),
        );
        expect(captured.body).toEqual([]);
        expect(await server.stores.fsEntry.getEntryByPath(junkPath)).toBeNull();
    });

    it('rejects the whole batch when one item is denied', async () => {
        const attacker = await makeUser();
        const victim = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(attacker.actor, () =>
                controller.batchWrites(
                    makeReq<WriteRequest[]>({
                        body: [
                            {
                                fileMetadata: {
                                    path: `/${attacker.username}/Documents/ok.txt`,
                                    size: 1,
                                },
                                fileContent: 'x',
                            },
                            {
                                fileMetadata: {
                                    path: `/${victim.username}/Documents/nope.txt`,
                                    size: 1,
                                },
                                fileContent: 'x',
                            },
                        ] as WriteRequest[],
                        actor: attacker.actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
        // The permitted sibling item must not have been committed either —
        // the ACL sweep runs before any byte is written.
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${attacker.username}/Documents/ok.txt`,
            ),
        ).toBeNull();
    });

    it('accepts the `text/plain;actually=json` content type puter.js sends', async () => {
        const { actor, username } = await makeUser();
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeReq<WriteRequest[]>({
                    body: [
                        {
                            fileMetadata: {
                                path: `/${username}/Documents/text-plain.txt`,
                                size: 1,
                            },
                            fileContent: 'x',
                        },
                    ] as WriteRequest[],
                    headers: { 'content-type': 'text/plain;actually=json' },
                    actor,
                }),
                res,
            ),
        );
        expect(captured.body).toHaveLength(1);
    });

    it('rejects an unsupported content type with 415', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeReq<WriteRequest[]>({
                        body: [],
                        headers: { 'content-type': 'application/xml' },
                        actor,
                    }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 415,
            legacyCode: 'bad_request',
        });
    });

    it('rejects a request with no content type at all with 415', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeReq<WriteRequest[]>({ body: [], headers: {}, actor }),
                    res,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 415 });
    });
});

// -- /fs/batchWrite (multipart mode) ----------------------------------

describe('FSController.batchWrites (multipart)', () => {
    const manifestFor = (paths: string[]) =>
        JSON.stringify({
            items: paths.map((path, index) => ({
                index,
                fileMetadata: { path, size: 0 },
            })),
        });

    it('streams each file part into the matching manifest entry', async () => {
        const { actor, username } = await makeUser();
        const paths = [
            `/${username}/Documents/mp-a.txt`,
            `/${username}/Documents/mp-b.txt`,
        ];
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeMultipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'manifest',
                            value: manifestFor(paths),
                        },
                        {
                            kind: 'file',
                            name: 'file-0',
                            filename: 'a.txt',
                            content: 'alpha',
                        },
                        {
                            kind: 'file',
                            name: 'file-1',
                            filename: 'b.txt',
                            content: 'beta!!',
                        },
                    ],
                    actor,
                ),
                res,
            ),
        );
        const body = captured.body as Array<{
            fsEntry: Record<string, unknown>;
        }>;
        expect(body.map((r) => r.fsEntry.path).sort()).toEqual(
            [...paths].sort(),
        );
        const stored = await server.stores.fsEntry.getEntryByPath(paths[0]!);
        expect(stored?.size).toBe(5);
    });

    it('maps positional `file` parts onto manifest order', async () => {
        const { actor, username } = await makeUser();
        const paths = [`/${username}/Documents/mp-pos.txt`];
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeMultipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'manifest',
                            value: manifestFor(paths),
                        },
                        {
                            kind: 'file',
                            name: 'file',
                            filename: 'x.txt',
                            content: 'positional',
                        },
                    ],
                    actor,
                ),
                res,
            ),
        );
        expect(captured.body).toHaveLength(1);
        const stored = await server.stores.fsEntry.getEntryByPath(paths[0]!);
        expect(stored?.size).toBe(10);
    });

    it('drains .DS_Store parts without writing them', async () => {
        const { actor, username } = await makeUser();
        const junk = `/${username}/Documents/.DS_Store`;
        const real = `/${username}/Documents/mp-keep.txt`;
        const { res, captured } = makeRes();
        await withActor(actor, () =>
            controller.batchWrites(
                makeMultipartReq(
                    [
                        {
                            kind: 'field',
                            name: 'manifest',
                            value: manifestFor([junk, real]),
                        },
                        {
                            kind: 'file',
                            name: 'file-0',
                            filename: '.DS_Store',
                            content: 'junk',
                        },
                        {
                            kind: 'file',
                            name: 'file-1',
                            filename: 'keep.txt',
                            content: 'keepme',
                        },
                    ],
                    actor,
                ),
                res,
            ),
        );
        expect(captured.body).toHaveLength(1);
        expect(await server.stores.fsEntry.getEntryByPath(junk)).toBeNull();
        expect(await server.stores.fsEntry.getEntryByPath(real)).not.toBeNull();
    });

    it('rejects a multipart body with no manifest', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'file',
                                name: 'file-0',
                                filename: 'a.txt',
                                content: 'x',
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Batch write manifest is required',
        });
    });

    it('rejects a manifest that is not valid JSON', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: '{not json',
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Batch write manifest is not valid JSON',
        });
    });

    it('rejects a manifest with an empty items array', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: JSON.stringify({ items: [] }),
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('non-empty items array'),
        });
    });

    it('rejects a manifest item without fileMetadata', async () => {
        const { actor } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: JSON.stringify({
                                    items: [{ index: 0 }],
                                }),
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('missing fileMetadata'),
        });
    });

    it('rejects a manifest item with a negative index', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: JSON.stringify({
                                    items: [
                                        {
                                            index: -1,
                                            fileMetadata: {
                                                path: `/${username}/Documents/x.txt`,
                                            },
                                        },
                                    ],
                                }),
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('item index is invalid'),
        });
    });

    it('rejects a manifest with duplicate indexes as a conflict', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: JSON.stringify({
                                    items: [
                                        {
                                            index: 0,
                                            fileMetadata: {
                                                path: `/${username}/Documents/dup1.txt`,
                                            },
                                        },
                                        {
                                            index: 0,
                                            fileMetadata: {
                                                path: `/${username}/Documents/dup2.txt`,
                                            },
                                        },
                                    ],
                                }),
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'conflict',
        });
    });

    it('rejects two manifest fields in one request', async () => {
        const { actor, username } = await makeUser();
        const manifest = manifestFor([`/${username}/Documents/twice.txt`]);
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: manifest,
                            },
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: manifest,
                            },
                            {
                                kind: 'file',
                                name: 'file-0',
                                filename: 'a.txt',
                                content: 'x',
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('more than once'),
        });
    });

    it('cleans up already-uploaded objects when a late parse failure aborts the batch', async () => {
        // Ordering matters: the duplicate `manifest` field has to land *after*
        // the file part has already been streamed to storage, so `parseFailure`
        // is set with a successful upload on the books. That object has no DB
        // row and must be swept, otherwise a malformed request leaks storage.
        // Feeding the body in delayed chunks is what puts the upload ahead of
        // the failure — a single-buffer body settles both in the same tick.
        const { actor, username } = await makeUser();
        const manifest = manifestFor([`/${username}/Documents/late-fail.txt`]);
        const segments = [
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${manifest}\r\n`,
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file-0"; filename="a.txt"\r\n` +
                'Content-Type: application/octet-stream\r\n\r\nuploaded-then-aborted\r\n',
            // Closing this part's boundary ends the file stream, so the upload
            // runs to completion during the gap before the next segment.
            `--${BOUNDARY}\r\n`,
            `Content-Disposition: form-data; name="manifest"\r\n\r\n${manifest}\r\n--${BOUNDARY}--\r\n`,
        ];
        const stream = Readable.from(
            (async function* () {
                for (const [i, segment] of segments.entries()) {
                    if (i > 0) {
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                    yield Buffer.from(segment, 'utf8');
                }
            })(),
        );
        const req = Object.assign(stream, {
            body: undefined,
            query: {},
            headers: {
                'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
            },
            actor,
            user: { id: actor.user!.id!, username: actor.user!.username! },
        }) as unknown as Request;

        const cleanupSpy = vi.spyOn(
            server.services.fs,
            'cleanupPreparedBatchUploads',
        );
        const { res } = makeRes();
        try {
            await expect(
                withActor(actor, () => controller.batchWrites(req, res)),
            ).rejects.toMatchObject({
                statusCode: 409,
                message: expect.stringContaining('more than once'),
            });
            expect(cleanupSpy).toHaveBeenCalledTimes(1);
            expect(cleanupSpy.mock.calls[0]![1]).toHaveLength(1);
        } finally {
            cleanupSpy.mockRestore();
        }
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${username}/Documents/late-fail.txt`,
            ),
        ).toBeNull();
    });

    it('rejects file content that arrives before the manifest', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'file',
                                name: 'file-0',
                                filename: 'a.txt',
                                content: 'early',
                            },
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: manifestFor([
                                    `/${username}/Documents/late.txt`,
                                ]),
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Batch write manifest must come before file content',
        });
    });

    it('rejects duplicate file content for the same manifest index', async () => {
        const { actor, username } = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: manifestFor([
                                    `/${username}/Documents/dupfile.txt`,
                                ]),
                            },
                            {
                                kind: 'file',
                                name: 'file-0',
                                filename: 'a.txt',
                                content: 'one',
                            },
                            {
                                kind: 'file',
                                name: 'file-0',
                                filename: 'a.txt',
                                content: 'two',
                            },
                        ],
                        actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('Duplicate file content'),
        });
    });

    it('denies the whole multipart batch when a manifest path is not writable', async () => {
        const attacker = await makeUser();
        const victim = await makeUser();
        const { res } = makeRes();
        await expect(
            withActor(attacker.actor, () =>
                controller.batchWrites(
                    makeMultipartReq(
                        [
                            {
                                kind: 'field',
                                name: 'manifest',
                                value: manifestFor([
                                    `/${victim.username}/Documents/stolen.txt`,
                                ]),
                            },
                            {
                                kind: 'file',
                                name: 'file-0',
                                filename: 'a.txt',
                                content: 'x',
                            },
                        ],
                        attacker.actor,
                    ),
                    res,
                ),
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
        });
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/${victim.username}/Documents/stolen.txt`,
            ),
        ).toBeNull();
    });
});

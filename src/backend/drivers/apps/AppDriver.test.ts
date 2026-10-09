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
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { decodeCursor } from '../../util/pagination.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer (in-memory sqlite + dynamo + s3 + mock redis)
// and exercises the live AppDriver (`puter-apps`) against the real
// AppStore. Each test makes its own user via `makeUser` so app rows
// from one test don't pollute another's `select` results.

let server: PuterServer;
// AppDriver is a JS module without an exported class type; treat as a
// generic CRUD-Q surface so we don't fight TS over private internals.
type CrudQDriver = {
    create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    read: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    select: (args: Record<string, unknown>) => Promise<unknown[]>;
    update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    upsert: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (args: Record<string, unknown>) => Promise<{ success: boolean; uid: string }>;
    isNameAvailable: (name: string) => Promise<boolean>;
};
let driver: CrudQDriver;

beforeAll(async () => {
    server = await setupTestServer();
    driver = server.drivers.apps as unknown as CrudQDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `ad-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
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

const uniqueName = (prefix: string) =>
    `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const uniqueIndexUrl = () =>
    `https://example-${Math.random().toString(36).slice(2, 10)}.test/`;

// ── create ──────────────────────────────────────────────────────────

describe('AppDriver.create', () => {
    it('creates an app and stamps the actor as owner', async () => {
        const { actor, userId } = await makeUser();
        const name = uniqueName('app');

        const result = await withActor(actor, () =>
            driver.create({
                object: {
                    name,
                    title: 'My App',
                    description: 'desc',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        expect(result.uid).toEqual(expect.any(String));
        expect(result.name).toBe(name);
        expect(result.title).toBe('My App');
        // `owner` is only attached when the actor is the owner.
        expect(result.owner).toMatchObject({ username: actor.user!.username });

        // Confirm DB-level ownership.
        const stored = await server.stores.app.getByUid(result.uid as string);
        expect(stored?.owner_user_id).toBe(userId);
    });

    it('rejects an invalid app name with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: 'has spaces',
                        title: 'x',
                        index_url: uniqueIndexUrl(),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a missing index_url with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: { name: uniqueName('no-url'), title: 't' },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    // App iframes get `allow-same-origin allow-scripts`, so an index_url
    // on a Puter system host would run third-party code same-origin with
    // the GUI. The test server's domain is `puter.localhost` (from
    // config.default.json).
    it.each([
        ['the GUI host', 'https://puter.localhost/evil.html'],
        ['the GUI host on another port/scheme', 'http://puter.localhost:4100/evil.html'],
        ['the API host', 'https://api.puter.localhost/evil.html'],
        ['the builtin sentinel host', 'https://builtins.namespaces.puter.com/emulator'],
    ])('rejects an index_url on %s with 400', async (_label, index_url) => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('sys-host'),
                        title: 't',
                        index_url,
                    },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: /system host/,
        });
    });

    it('rejects updating an index_url to a Puter system host with 400', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('sys-host-upd'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        await expect(
            withActor(actor, () =>
                driver.update({
                    uid: created.uid,
                    object: { index_url: 'https://puter.localhost/evil.html' },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: /system host/,
        });
    });

    it('rejects a duplicate app name with 400', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const name = uniqueName('dup');

        await withActor(a.actor, () =>
            driver.create({
                object: { name, title: 'a', index_url: uniqueIndexUrl() },
            }),
        );
        await expect(
            withActor(b.actor, () =>
                driver.create({
                    object: {
                        name,
                        title: 'b',
                        index_url: uniqueIndexUrl(),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('reports a lost name-uniqueness race the way the check reports it', async () => {
        const { actor } = await makeUser();

        // The name check and the insert are two statements, so a name can be
        // claimed in between and only the unique index catches it. The
        // in-memory sqlite schema has no unique index on `apps`.`name` (mysql
        // and postgres do), so the losing insert is what gets stubbed here. A
        // raw driver error would escape as a 500 carrying the index name.
        const dup = Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
        });
        const create = vi
            .spyOn(server.stores.app, 'create')
            .mockRejectedValueOnce(dup);

        try {
            await expect(
                withActor(actor, () =>
                    driver.create({
                        object: {
                            name: uniqueName('race'),
                            title: 't',
                            index_url: uniqueIndexUrl(),
                        },
                    }),
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'app_name_already_in_use',
            });
        } finally {
            create.mockRestore();
        }
    });

    it('lets a non-uniqueness insert failure surface as a server error', async () => {
        const { actor } = await makeUser();

        const create = vi
            .spyOn(server.stores.app, 'create')
            .mockRejectedValueOnce(new Error('connection lost'));

        try {
            await expect(
                withActor(actor, () =>
                    driver.create({
                        object: {
                            name: uniqueName('boom'),
                            title: 't',
                            index_url: uniqueIndexUrl(),
                        },
                    }),
                ),
            ).rejects.toThrow('connection lost');
        } finally {
            create.mockRestore();
        }
    });

    it('dedupes a colliding name when `dedupe_name` is true', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('dedup');

        await withActor(actor, () =>
            driver.create({
                object: { name, title: 't', index_url: uniqueIndexUrl() },
            }),
        );
        const second = await withActor(actor, () =>
            driver.create({
                object: { name, title: 't', index_url: uniqueIndexUrl() },
                options: { dedupe_name: true },
            }),
        );

        expect(second.name).not.toBe(name);
        expect(String(second.name).startsWith(name)).toBe(true);
    });

    it('rejects a non-image data: icon with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('bad-icon'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        icon: 'data:text/plain;base64,AAAA',
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 401 with no actor in context', async () => {
        await expect(
            driver.create({
                object: {
                    name: uniqueName('noctx'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

// ── read ────────────────────────────────────────────────────────────

describe('AppDriver.read', () => {
    it('reads a public app for any actor', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const created = await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('public'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        const fetched = await withActor(b.actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(fetched.uid).toBe(created.uid);
        // Owner block is NOT exposed to non-owners.
        expect(fetched.owner).toBeUndefined();
    });

    it('reads via id object with `{ name }`', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('by-name');
        await withActor(actor, () =>
            driver.create({
                object: { name, title: 't', index_url: uniqueIndexUrl() },
            }),
        );
        const fetched = await withActor(actor, () =>
            driver.read({ id: { name } }),
        );
        expect(fetched.name).toBe(name);
    });

    it('returns 404 for a missing app', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.read({ uid: 'app-nonexistent' })),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// ── select ──────────────────────────────────────────────────────────

describe('AppDriver.select', () => {
    it('returns visible apps including those owned by other users', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const aName = uniqueName('a');
        const bName = uniqueName('b');
        await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: aName,
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        await withActor(b.actor, () =>
            driver.create({
                object: {
                    name: bName,
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        const result = (await withActor(a.actor, () =>
            driver.select({}),
        )) as Array<Record<string, unknown>>;
        const names = result.map((r) => r.name);
        expect(names).toContain(aName);
        expect(names).toContain(bName);
    });

    it('predicate `user-can-edit` filters to actor-owned apps only', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const mine = uniqueName('mine');
        await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: mine,
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        await withActor(b.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('theirs'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        const result = (await withActor(a.actor, () =>
            driver.select({ predicate: ['user-can-edit'] }),
        )) as Array<Record<string, unknown>>;

        // `select` only returns one row in this slice — the actor-owned
        // one. Caller filters server-side via `owner_user_id`.
        const names = result.map((r) => r.name);
        expect(names).toContain(mine);
        for (const row of result) {
            expect(row.owner).toMatchObject({
                username: a.actor.user!.username,
            });
        }
    });
});

// ── update / delete ─────────────────────────────────────────────────

describe('AppDriver.update', () => {
    it('updates editable fields on an owned app', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('upd'),
                    title: 'Old',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const updated = await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: { title: 'New', description: 'now with desc' },
            }),
        );
        expect(updated.title).toBe('New');
        expect(updated.description).toBe('now with desc');
    });

    it("rejects updating another user's app with 403", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const created = await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('cross'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        await expect(
            withActor(b.actor, () =>
                driver.update({
                    uid: created.uid,
                    object: { title: 'hacked' },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('AppDriver.delete', () => {
    it('deletes an owned app and reports `{ success, uid }`', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('del'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const result = await withActor(actor, () =>
            driver.delete({ uid: created.uid }),
        );
        expect(result).toEqual({ success: true, uid: created.uid });
        expect(
            await server.stores.app.getByUid(created.uid as string),
        ).toBeNull();
    });

    it('deletes the subdomain rows the app owns and leaves the rest', async () => {
        const { actor, userId } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('own'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const app = (await server.stores.app.getByUid(created.uid as string))!;
        const prefix = `appdel-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId,
            subdomain: `${prefix}-owned`,
            appOwner: app.id,
        });
        await server.stores.subdomain.create({
            userId,
            subdomain: `${prefix}-unowned`,
        });

        await withActor(actor, () => driver.delete({ uid: created.uid }));

        const remaining = await server.stores.subdomain.listByUserIdAndPrefix(
            userId,
            prefix,
        );
        expect(remaining.map((r) => r.subdomain)).toEqual([
            `${prefix}-unowned`,
        ]);
    });

    it("refuses to delete another user's app with 403", async () => {
        const a = await makeUser();
        const b = await makeUser();
        const created = await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('cross-del'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        await expect(
            withActor(b.actor, () => driver.delete({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 404 for a non-existent uid', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.delete({ uid: 'app-nonexistent' })),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

// ── upsert ──────────────────────────────────────────────────────────

describe('AppDriver.upsert', () => {
    it('creates when no row matches', async () => {
        const { actor } = await makeUser();
        const result = await withActor(actor, () =>
            driver.upsert({
                object: {
                    name: uniqueName('ups'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        expect(result.uid).toEqual(expect.any(String));
    });

    it('updates when a row already exists at the resolved uid', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('ups-existing'),
                    title: 'first',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        const result = await withActor(actor, () =>
            driver.upsert({
                uid: created.uid,
                object: { title: 'second' },
            }),
        );
        expect(result.title).toBe('second');
    });
});

// ── isNameAvailable ────────────────────────────────────────────────

describe('AppDriver.isNameAvailable', () => {
    it('returns true for an unused name', async () => {
        const result = await driver.isNameAvailable(uniqueName('avail'));
        expect(result).toBe(true);
    });

    it('returns false once an app has claimed the name', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('claimed');
        await withActor(actor, () =>
            driver.create({
                object: { name, title: 't', index_url: uniqueIndexUrl() },
            }),
        );
        const result = await driver.isNameAvailable(name);
        expect(result).toBe(false);
    });

    it('rejects an invalid name format with 400', async () => {
        await expect(driver.isNameAvailable('has spaces')).rejects.toMatchObject(
            { statusCode: 400 },
        );
    });
});

// ── create: additional validation branches ─────────────────────────

describe('AppDriver.create additional branches', () => {
    it('rejects with 400 when `object` is missing or not an object', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.create({})),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withActor(actor, () =>
                driver.create({ object: 'not an object' as unknown as object }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a too-long name with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: 'a'.repeat(101),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects when title is missing on create', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('no-title'),
                        index_url: uniqueIndexUrl(),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('accepts a valid data:image/png base64 icon', async () => {
        const { actor } = await makeUser();
        // 1x1 transparent PNG
        const png = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`;
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('icon'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    icon: png,
                },
            }),
        );
        expect(created.icon).toBe(png);
    });

    // The write path once validated only the MIME prefix, so an
    // allow-listed prefix plus arbitrary text was stored verbatim and later
    // interpolated into a Dev Center template — stored XSS in a godmode app
    // that carries the user's session token. Reachable with an app-under-user
    // token, the lowest-privilege credential we issue.
    describe('icon data URL payload validation', () => {
        const ATTACK_PAYLOAD =
            'data:image/png;base64,iVBORw0KGgo=" a5x="1"><img src=x onerror=window.__A5APP=1>';

        const createWithIcon = async (icon: string, label: string) => {
            const { actor } = await makeUser();
            return withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName(label),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        icon,
                    },
                }),
            );
        };

        it('rejects the reported breakout payload', async () => {
            await expect(
                createWithIcon(ATTACK_PAYLOAD, 'xss-icon'),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects the breakout payload on update, not just create', async () => {
            const { actor } = await makeUser();
            const created = await withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('xss-upd'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                    },
                }),
            );
            await expect(
                withActor(actor, () =>
                    driver.update({
                        uid: created.uid,
                        object: { icon: ATTACK_PAYLOAD },
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects an allow-listed MIME whose payload is not an image', async () => {
            // Valid base64, decodes cleanly — just isn't a PNG.
            const notAnImage = `data:image/png;base64,${Buffer.from(
                'not an image at all',
            ).toString('base64')}`;
            await expect(
                createWithIcon(notAnImage, 'notimg-icon'),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a payload whose bytes contradict the declared MIME', async () => {
            const pngBytes =
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
            await expect(
                createWithIcon(
                    `data:image/gif;base64,${pngBytes}`,
                    'mismatch-icon',
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects a percent-encoded (non-base64) data URL', async () => {
            // The only shape that can carry literal `<` and `"`.
            await expect(
                createWithIcon(
                    'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3C/svg%3E',
                    'pct-icon',
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects base64 with smuggled non-base64 characters', async () => {
            // `Buffer.from(…,'base64')` silently drops these; the
            // round-trip check is what catches them.
            await expect(
                createWithIcon(
                    'data:image/png;base64,iVBORw0KGgo=<script>alert(1)</script>',
                    'smuggle-icon',
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('accepts a base64 SVG icon and stores it canonically', async () => {
            const svg = Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
            ).toString('base64');
            const created = await createWithIcon(
                `data:image/svg+xml;base64,${svg}`,
                'svg-icon',
            );
            expect(created.icon).toBe(`data:image/svg+xml;base64,${svg}`);
        });

        it('accepts image/jpg as an alias of image/jpeg', async () => {
            // Minimal JPEG SOI + APP0 header — enough to sniff.
            const jpeg = Buffer.concat([
                Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
                Buffer.from('0000JFIF'),
            ]).toString('base64');
            const created = await createWithIcon(
                `data:image/jpg;base64,${jpeg}`,
                'jpg-icon',
            );
            expect(String(created.icon).startsWith('data:image/jpg;base64,')).toBe(
                true,
            );
        });

        it('strips line wrapping from an otherwise valid payload', async () => {
            const png =
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
            const wrapped = `${png.slice(0, 40)}\n${png.slice(40)}`;
            const created = await createWithIcon(
                `data:image/png;base64,${wrapped}`,
                'wrapped-icon',
            );
            expect(created.icon).toBe(`data:image/png;base64,${png}`);
        });

        it('rejects raw base64 that does not decode to an image', async () => {
            // v1 wrapped any base64 as image/png regardless of content.
            await expect(
                createWithIcon(
                    Buffer.from('definitely not an image payload').toString(
                        'base64',
                    ),
                    'rawtext-icon',
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    it('normalizes a raw-base64 icon into a data: URL', async () => {
        const { actor } = await makeUser();
        // Raw base64 of a 1x1 PNG (no data: prefix)
        const rawB64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('rawicon'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    icon: rawB64,
                },
            }),
        );
        expect(typeof created.icon).toBe('string');
        expect(String(created.icon).startsWith('data:image/')).toBe(true);
    });

    it('rejects an icon URL that is neither base64, data:, nor an app-icon endpoint', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('bad-icon-url'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        icon: 'https://evil.example/icon.png',
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('persists metadata, maximize_on_start, and background flags', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('flags'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    maximize_on_start: true,
                    background: true,
                    metadata: { foo: 'bar' },
                },
            }),
        );
        expect(created.maximize_on_start).toBe(true);
        expect(created.background).toBe(true);
        // metadata round-trips as a JSON string in the wire shape.
        const parsed =
            typeof created.metadata === 'string'
                ? JSON.parse(created.metadata)
                : created.metadata;
        expect(parsed).toEqual({ foo: 'bar' });
    });

    it('persists filetype_associations as an array', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('ft'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    filetype_associations: ['.txt', '.md'],
                },
            }),
        );
        expect(Array.isArray(created.filetype_associations)).toBe(true);
        // Dotted input is canonicalized to the bare lowercase extension.
        expect(created.filetype_associations).toEqual(
            expect.arrayContaining(['txt', 'md']),
        );
    });

    it('rejects too-long title with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('lt'),
                        title: 'x'.repeat(101),
                        index_url: uniqueIndexUrl(),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects too-long description with 400', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('ld'),
                        title: 't',
                        description: 'd'.repeat(7001),
                        index_url: uniqueIndexUrl(),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    // -- metadata size cap -------------------------------------------

    it('accepts metadata at exactly the 16 KiB JSON byte cap and rejects one byte over', async () => {
        const { actor } = await makeUser();
        // `{"a":"` + value + `"}` is 8 bytes of fixed JSON around the value.
        const maxBytes = 16 * 1024;
        const atCap = { a: 'x'.repeat(maxBytes - 8) };
        const overCap = { a: 'x'.repeat(maxBytes - 7) };
        expect(Buffer.byteLength(JSON.stringify(atCap))).toBe(maxBytes);

        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('meta-cap'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    metadata: atCap,
                },
            }),
        );
        const meta =
            typeof created.metadata === 'string'
                ? JSON.parse(created.metadata)
                : created.metadata;
        expect(meta).toEqual(atCap);

        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('meta-over'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        metadata: overCap,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects metadata whose byte length (not char length) exceeds the cap', async () => {
        const { actor } = await makeUser();
        // Each 'é' is one JS string character but two UTF-8 bytes: this value
        // is well under 16,384 *characters* but over it in bytes.
        const value = 'é'.repeat(8200);
        expect(JSON.stringify({ a: value }).length).toBeLessThan(16 * 1024);
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('meta-bytes'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        metadata: { a: value },
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects an oversize metadata update and leaves the row unchanged', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('meta-upd'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    metadata: { ok: true },
                },
            }),
        );

        await expect(
            withActor(actor, () =>
                driver.update({
                    uid: created.uid,
                    object: { metadata: { a: 'x'.repeat(16 * 1024) } },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        const after = await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        );
        const meta =
            typeof after.metadata === 'string'
                ? JSON.parse(after.metadata)
                : after.metadata;
        expect(meta).toEqual({ ok: true });
    });

    // -- filetype_associations caps ------------------------------------

    it('rejects more than 200 filetype_associations and accepts exactly 200', async () => {
        const { actor } = await makeUser();
        const tooMany = Array.from({ length: 201 }, (_, i) => `t${i}`);
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('ft-over'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        filetype_associations: tooMany,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        const atCap = Array.from({ length: 200 }, (_, i) => `t${i}`);
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('ft-ok'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    filetype_associations: atCap,
                },
            }),
        );
        expect(created.filetype_associations).toHaveLength(200);
    });

    it('rejects a filetype entry over 60 characters and accepts one at 60', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('ft-len-over'),
                        title: 't',
                        index_url: uniqueIndexUrl(),
                        filetype_associations: ['x'.repeat(61)],
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('ft-len-ok'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    filetype_associations: ['x'.repeat(60)],
                },
            }),
        );
        expect(created.filetype_associations).toEqual(
            expect.arrayContaining(['x'.repeat(60)]),
        );
    });
});

// ── update: additional branches ────────────────────────────────────

describe('AppDriver.update additional branches', () => {
    it('rejects with 400 when object is missing or invalid', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('u1'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        await expect(
            withActor(actor, () => driver.update({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 404 when neither uid/id matches anything', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.update({
                    uid: 'app-nonexistent',
                    object: { title: 'x' },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('renames an app and persists the new name', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('old'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const newName = uniqueName('renamed');
        const updated = await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: { name: newName },
            }),
        );
        expect(updated.name).toBe(newName);
    });

    it('rejects renaming to a name already taken with 409', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const claimed = uniqueName('claimed');
        // a registers `claimed`.
        await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: claimed,
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        // b creates a separate app, then tries to rename to `claimed`.
        const bApp = await withActor(b.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('temp'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        await expect(
            withActor(b.actor, () =>
                driver.update({
                    uid: bApp.uid,
                    object: { name: claimed },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('reports a lost rename-uniqueness race as 409, not a 500', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('ren'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        const dup = Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
        });
        const update = vi
            .spyOn(server.stores.app, 'update')
            .mockRejectedValueOnce(dup);

        try {
            await expect(
                withActor(actor, () =>
                    driver.update({
                        uid: created.uid,
                        object: { name: uniqueName('taken') },
                    }),
                ),
            ).rejects.toMatchObject({
                statusCode: 409,
                legacyCode: 'conflict',
            });
        } finally {
            update.mockRestore();
        }
    });

    it('updates metadata and filetype_associations on an owned app', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('upd-meta'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                    filetype_associations: ['.txt'],
                },
            }),
        );
        const updated = await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: {
                    metadata: { version: 2 },
                    filetype_associations: ['.md', '.csv'],
                },
            }),
        );
        const meta =
            typeof updated.metadata === 'string'
                ? JSON.parse(updated.metadata)
                : updated.metadata;
        expect(meta).toEqual({ version: 2 });
        // Dotted input is canonicalized to the bare lowercase extension.
        expect(updated.filetype_associations).toEqual(
            expect.arrayContaining(['md', 'csv']),
        );
    });
});

// ── read: additional branches ──────────────────────────────────────

describe('AppDriver.read additional branches', () => {
    it('reads via id object with `{ uid }`', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('rid'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const fetched = await withActor(actor, () =>
            driver.read({ id: { uid: created.uid } }),
        );
        expect(fetched.uid).toBe(created.uid);
    });

    it('reads via numeric `id` (positional number)', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('rid-num'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const row = await server.stores.app.getByUid(created.uid as string);
        const fetched = await withActor(actor, () =>
            driver.read({ id: row!.id }),
        );
        expect(fetched.uid).toBe(created.uid);
    });

    it('throws 401 when there is no actor in context', async () => {
        await expect(driver.read({ uid: 'app-anything' })).rejects.toMatchObject(
            { statusCode: 401 },
        );
    });
});

// ── delete: protected-app branch ───────────────────────────────────

describe('AppDriver.delete additional branches', () => {
    it('rejects deleting a protected app with 403', async () => {
        const { actor } = await makeUser();
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('prot'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const row = await server.stores.app.getByUid(created.uid as string);
        // `protected` is in READ_ONLY_COLUMNS so AppStore.update filters it
        // out — write directly, then invalidate so the next getByUid hits
        // the fresh row.
        await server.clients.db.write(
            'UPDATE `apps` SET `protected` = 1 WHERE `id` = ?',
            [row!.id],
        );
        await server.stores.app.invalidateByUid(created.uid as string);
        await expect(
            withActor(actor, () => driver.delete({ uid: created.uid })),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});

// ── select: predicate + visibility ─────────────────────────────────

describe('AppDriver.select additional branches', () => {
    it('returns [] for an unauthenticated caller (throws 401)', async () => {
        await expect(driver.select({})).rejects.toMatchObject({
            statusCode: 401,
        });
    });
});

// -- select pagination --

describe('AppDriver.select pagination', () => {
    const makeApps = async (count: number) => {
        const { actor } = await makeUser();
        const names: string[] = [];
        for (let i = 0; i < count; i++) {
            const name = uniqueName(`pg${i}`);
            names.push(name);
            await withActor(actor, () =>
                driver.create({
                    object: { name, title: 't', index_url: uniqueIndexUrl() },
                }),
            );
        }
        return { actor, names };
    };

    it('keeps the bare array response for plain limit requests', async () => {
        const { actor } = await makeApps(2);
        const result = await withActor(actor, () =>
            driver.select({ predicate: ['user-can-edit'], limit: 1 }),
        );
        expect(Array.isArray(result)).toBe(true);
        expect((result as unknown[]).length).toBe(1);
    });

    it('pages through owned apps with cursors', async () => {
        const { actor, names } = await makeApps(5);
        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        do {
            const page = (await withActor(actor, () =>
                driver.select({
                    predicate: ['user-can-edit'],
                    limit: 2,
                    cursor,
                }),
            )) as { items: Array<{ name: string }>; cursor?: string };
            seen.push(...page.items.map((r) => r.name));
            cursor = page.cursor;
            // Sealed: it reads as nothing but a cursor.
            if (cursor) expect(() => decodeCursor(cursor)).toThrow();
        } while (cursor);
        expect(seen).toEqual(names);
    });

    it('supports offset paging', async () => {
        const { actor, names } = await makeApps(3);
        const page = (await withActor(actor, () =>
            driver.select({
                predicate: ['user-can-edit'],
                limit: 10,
                offset: 1,
            }),
        )) as { items: Array<{ name: string }> };
        expect(page.items.map((r) => r.name)).toEqual(names.slice(1));
    });

    it('rejects cursor combined with offset', async () => {
        const { actor } = await makeApps(2);
        const first = (await withActor(actor, () =>
            driver.select({
                predicate: ['user-can-edit'],
                limit: 1,
                cursor: null,
            }),
        )) as { cursor?: string };
        expect(first.cursor).toBeDefined();
        await expect(
            withActor(actor, () =>
                driver.select({ offset: 1, cursor: first.cursor }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('reports an exact total for owner-scoped selects', async () => {
        const { actor, names } = await makeApps(3);
        const page = (await withActor(actor, () =>
            driver.select({
                predicate: ['user-can-edit'],
                limit: 1,
                includeTotal: true,
            }),
        )) as { items: unknown[]; total?: number };
        expect(page.items.length).toBe(1);
        expect(page.total).toBe(names.length);
    });

    it("hides other users' protected apps from paginated catalog listings", async () => {
        const a = await makeApps(3);
        const [visible1, hidden, visible2] = a.names;
        const created = await withActor(a.actor, () =>
            driver.read({ id: { name: hidden } }),
        );
        const row = await server.stores.app.getByUid(
            (created as Record<string, unknown>).uid as string,
        );
        await server.clients.db.write(
            'UPDATE `apps` SET `protected` = 1 WHERE `id` = ?',
            [row!.id],
        );
        await server.stores.app.invalidateByUid(row!.uid as string);

        const b = await makeUser();
        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        do {
            const page = (await withActor(b.actor, () =>
                driver.select({ limit: 50, cursor }),
            )) as { items: Array<{ name: string }>; cursor?: string };
            seen.push(...page.items.map((r) => r.name));
            cursor = page.cursor;
        } while (cursor);

        expect(seen).toContain(visible1);
        expect(seen).toContain(visible2);
        expect(seen).not.toContain(hidden);
    });
});

// ── upsert ──────────────────────────────────────────────────────────

describe('AppDriver.upsert additional branches', () => {
    it('updates by resolved id when a row matches', async () => {
        const { actor } = await makeUser();
        const name = uniqueName('ups-by-id');
        const created = await withActor(actor, () =>
            driver.create({
                object: { name, title: 't', index_url: uniqueIndexUrl() },
            }),
        );
        const result = await withActor(actor, () =>
            driver.upsert({
                id: { uid: created.uid },
                object: { title: 'replaced' },
            }),
        );
        expect(result.title).toBe('replaced');
    });
});

// ── isNameAvailable extra branch ───────────────────────────────────

describe('AppDriver.isNameAvailable additional branches', () => {
    it('rejects a too-long name with 400', async () => {
        await expect(driver.isNameAvailable('a'.repeat(101))).rejects.toMatchObject(
            { statusCode: 400 },
        );
    });
});

// ── alias-group custom domains (`app_origin_aliases`) ──────────────
//
// Custom hosts claimed by an alias group get the same bootstrap-stub
// merge treatment as puter-hosted subdomains: creating or repointing
// an app at an aliased host absorbs the unowned origin-bootstrap row
// instead of rejecting with `app_index_url_already_in_use`.

describe('AppDriver alias-group index_url merge', () => {
    const aliasHostA = `alias-a-${Math.random().toString(36).slice(2, 10)}.test`;
    const aliasHostB = `alias-b-${Math.random().toString(36).slice(2, 10)}.test`;
    const aliasHostC = `alias-c-${Math.random().toString(36).slice(2, 10)}.test`;

    // `config` is protected on PuterDriver; reach in to toggle the alias
    // groups for this block only. `#getOriginAliasGroups` reads config at
    // call time, so runtime mutation takes effect immediately.
    const driverConfig = () =>
        (driver as unknown as { config: Record<string, unknown> }).config;

    beforeAll(() => {
        driverConfig().app_origin_aliases = [
            [aliasHostA],
            [aliasHostB],
            [aliasHostC],
        ];
    });

    afterAll(() => {
        delete driverConfig().app_origin_aliases;
    });

    const makeBootstrapStub = async (host: string) => {
        const stubUid = `app-${uuidv4()}`;
        // Mirrors AuthController's get-user-app-token bootstrap path:
        // origin persisted as index_url, no owner, name === uid.
        await server.stores.app.createFromOrigin(stubUid, `https://${host}`);
        return stubUid;
    };

    it('create at an aliased host absorbs the unowned bootstrap stub', async () => {
        const { actor, userId } = await makeUser();
        const stubUid = await makeBootstrapStub(aliasHostA);
        const name = uniqueName('alias-create');

        const result = await withActor(actor, () =>
            driver.create({
                object: {
                    name,
                    title: 'Aliased',
                    index_url: `https://${aliasHostA}/`,
                },
            }),
        );

        // The stub row survives as the canonical app, claimed + merged.
        expect(result.uid).toBe(stubUid);
        expect(result.name).toBe(name);
        const stored = await server.stores.app.getByUid(stubUid);
        expect(stored?.owner_user_id).toBe(userId);
    });

    it('rejects another user registering an app under a reserved aliased host', async () => {
        const other = await makeUser();
        await expect(
            withActor(other.actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('squatter'),
                        title: 't',
                        index_url: `https://${aliasHostA}/index.html`,
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('update repointing to an aliased host merges and aliases the old uid', async () => {
        const { actor, userId } = await makeUser();
        const stubUid = await makeBootstrapStub(aliasHostB);

        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('alias-upd'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );

        const updated = await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: { index_url: `https://${aliasHostB}/` },
            }),
        );

        // Merged into the stub; source row deleted; old uid still resolves
        // via the canonical-uid alias.
        expect(updated.uid).toBe(stubUid);
        expect(await server.stores.app.getByUid(created.uid as string)).toBeNull();
        const stored = await server.stores.app.getByUid(stubUid);
        expect(stored?.owner_user_id).toBe(userId);

        const viaOldUid = await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(viaOldUid.uid).toBe(stubUid);
    });

    it("update merge hands the source app's owned subdomain rows to the joined app", async () => {
        const { actor, userId } = await makeUser();
        const stubUid = await makeBootstrapStub(aliasHostC);
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('alias-own'),
                    title: 't',
                    index_url: uniqueIndexUrl(),
                },
            }),
        );
        const sourceApp = (await server.stores.app.getByUid(
            created.uid as string,
        ))!;
        const subdomain = `merge-${Math.random().toString(36).slice(2, 8)}`;
        await server.stores.subdomain.create({
            userId,
            subdomain,
            appOwner: sourceApp.id,
        });

        const updated = await withActor(actor, () =>
            driver.update({
                uid: created.uid,
                object: { index_url: `https://${aliasHostC}/` },
            }),
        );
        expect(updated.uid).toBe(stubUid);

        // The source row is gone; its subdomain row survives under the joined
        // app rather than cascading away with the source.
        const stub = (await server.stores.app.getByUid(stubUid))!;
        const [row] = await server.stores.subdomain.listByUserIdAndPrefix(
            userId,
            subdomain,
        );
        expect(row).toBeTruthy();
        expect(Number(row!.app_owner)).toBe(stub.id);
    });

    it('leaves unrelated custom domains untouched (no alias group, no conflict check)', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const sharedUrl = uniqueIndexUrl();

        // Non-puter, non-aliased hosts keep their historical behavior:
        // no uniqueness enforcement, both creates succeed.
        const first = await withActor(a.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('plain-a'),
                    title: 't',
                    index_url: sharedUrl,
                },
            }),
        );
        const second = await withActor(b.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('plain-b'),
                    title: 't',
                    index_url: sharedUrl,
                },
            }),
        );
        expect(first.uid).not.toBe(second.uid);
    });
});

// ── hosted-subdomain ownership check ────────────────────────────────
//
// `#ensurePuterSiteSubdomainIsOwned` gates puter-hosted index_urls on a
// subdomain row the caller owns. Deploy flows create that row and point
// the app at it in back-to-back requests, so the check must tolerate a
// replica/cache miss by confirming against the primary before refusing.

describe('AppDriver hosted-subdomain ownership check', () => {
    const hostedUrl = (sub: string) => `https://${sub}.site.puter.localhost/`;

    it('accepts a hosted index_url when the subdomain row has not reached the replica yet', async () => {
        const { actor, userId } = await makeUser();
        const sub = uniqueName('deploy');
        await server.stores.subdomain.create({ userId, subdomain: sub });

        // Simulate a peer node with a lagging replica: no cache entry for
        // the row, and replica reads (`read`) that don't see it yet while
        // primary reads (`pread`) do. Sqlite's `pread` delegates to
        // `this.read`, so pin it to the original before stubbing `read`.
        await server.clients.redis.del(`subdomains:name:${sub}`);
        const db = server.clients.db as unknown as {
            read: (q: string, p?: unknown[]) => Promise<unknown[]>;
            pread: (q: string, p?: unknown[]) => Promise<unknown[]>;
        };
        const originalRead = db.read.bind(server.clients.db);
        const hadOwnPread = Object.prototype.hasOwnProperty.call(db, 'pread');
        db.pread = async (query: string, params?: unknown[]) =>
            originalRead(query, params);
        db.read = async (query: string, params?: unknown[]) =>
            query.includes('FROM `subdomains`') && (params ?? []).includes(sub)
                ? []
                : originalRead(query, params);

        try {
            const result = await withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('app'),
                        title: 'Deployed App',
                        index_url: hostedUrl(sub),
                    },
                }),
            );
            expect(result.uid).toEqual(expect.any(String));

            // The primary hit must also heal the stale cache: a normal
            // lookup now resolves from cache even though the replica
            // still misses.
            const healed =
                await server.stores.subdomain.getBySubdomain(sub);
            expect(healed?.subdomain).toBe(sub);
        } finally {
            delete (db as { read?: unknown }).read;
            if (!hadOwnPread) delete (db as { pread?: unknown }).pread;
        }
    });

    it('create merges into an owner-stamped bootstrap stub for an owned subdomain', async () => {
        // The get-user-app-token bootstrap path stamps the subdomain owner
        // on the stub at mint time — the owner's later create must still
        // absorb the stub (claimOwnership is skipped, merge proceeds).
        const { actor, userId } = await makeUser();
        const sub = uniqueName('ownedstub');
        await server.stores.subdomain.create({ userId, subdomain: sub });
        const stubUid = `app-${uuidv4()}`;
        await server.stores.app.createFromOrigin(
            stubUid,
            `https://${sub}.site.puter.localhost`,
            { ownerUserId: userId },
        );

        const name = uniqueName('owned-create');
        const result = await withActor(actor, () =>
            driver.create({
                object: {
                    name,
                    title: 'Owned stub',
                    index_url: hostedUrl(sub),
                },
            }),
        );

        expect(result.uid).toBe(stubUid);
        expect(result.name).toBe(name);
        const stored = await server.stores.app.getByUid(stubUid);
        expect(stored?.owner_user_id).toBe(userId);
    });

    it('create absorbs a bootstrap stub minted on an alternate hosting domain', async () => {
        const { actor, userId } = await makeUser();
        const sub = uniqueName('altstub');
        await server.stores.subdomain.create({ userId, subdomain: sub });
        const stubUid = `app-${uuidv4()}`;
        await server.stores.app.createFromOrigin(
            stubUid,
            `https://${sub}.host.puter.localhost`,
            { ownerUserId: userId },
        );

        const name = uniqueName('alt-create');
        const result = await withActor(actor, () =>
            driver.create({
                object: {
                    name,
                    title: 'Alt-host stub',
                    index_url: hostedUrl(sub),
                },
            }),
        );

        expect(result.uid).toBe(stubUid);
        expect(result.name).toBe(name);
        const stored = await server.stores.app.getByUid(stubUid);
        expect(stored?.index_url).toBe(hostedUrl(sub));
    });

    it('rejects a hosted index_url whose subdomain does not exist anywhere', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('app'),
                        title: 'x',
                        index_url: hostedUrl(uniqueName('ghost')),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects a hosted index_url pointing at another user's subdomain", async () => {
        const owner = await makeUser();
        const intruder = await makeUser();
        const sub = uniqueName('theirs');
        await server.stores.subdomain.create({
            userId: owner.userId,
            subdomain: sub,
        });

        await expect(
            withActor(intruder.actor, () =>
                driver.create({
                    object: {
                        name: uniqueName('app'),
                        title: 'x',
                        index_url: hostedUrl(sub),
                    },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    // -- Launch guard: the backing subdomain can disappear AFTER the app
    // was created (deleted by its owner, then reclaimable by anyone). The
    // read path must refuse to launch so the GUI never appends the launch
    // token to a now-reclaimable origin.

    it('denies launch when the hosted subdomain is later deleted', async () => {
        const { actor, userId } = await makeUser();
        const sub = uniqueName('gone');
        const row = await server.stores.subdomain.create({
            userId,
            subdomain: sub,
        });

        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('app'),
                    title: 'Backed App',
                    index_url: hostedUrl(sub),
                },
            }),
        );

        // While the subdomain is still owned, the app launches normally.
        const before = await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(String(before.index_url)).toContain(sub);
        expect(
            (before.privateAccess as { hasAccess?: boolean } | undefined)
                ?.hasAccess,
        ).not.toBe(false);

        // Delete the subdomain but keep the app pointing at it.
        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId },
        );

        const after = await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        );
        const access = after.privateAccess as {
            hasAccess?: boolean;
            reason?: string;
        };
        expect(access?.hasAccess).toBe(false);
        expect(access?.reason).toBe('hosted_backing_unavailable');
    });

    it('withholds the stale index_url from everyone but the owner', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const sub = uniqueName('stale');
        const row = await server.stores.subdomain.create({
            userId: owner.userId,
            subdomain: sub,
        });

        const created = await withActor(owner.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('app'),
                    title: 'Backed App',
                    index_url: hostedUrl(sub),
                },
            }),
        );
        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId: owner.userId },
        );

        // The owner still sees it — dev center renders the URL in the app's
        // edit form, and it's their row to repoint.
        const asOwner = await withActor(owner.actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(String(asOwner.index_url)).toContain(sub);

        // Anyone else gets the denial without the URL it suppresses, so a
        // consumer that reads `index_url` without reading the verdict still
        // can't hand it to the launcher.
        const asOther = await withActor(other.actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(asOther.index_url).toBeUndefined();
        expect(
            (asOther.privateAccess as { hasAccess?: boolean }).hasAccess,
        ).toBe(false);
    });

    it('denies launch when the hosted subdomain was reclaimed by another user', async () => {
        const owner = await makeUser();
        const attacker = await makeUser();
        const sub = uniqueName('reclaim');
        const row = await server.stores.subdomain.create({
            userId: owner.userId,
            subdomain: sub,
        });

        const created = await withActor(owner.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('app'),
                    title: 'Backed App',
                    index_url: hostedUrl(sub),
                },
            }),
        );

        // Owner deletes the subdomain; the attacker re-registers the name.
        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId: owner.userId },
        );
        await server.stores.subdomain.create({
            userId: attacker.userId,
            subdomain: sub,
        });

        const after = await withActor(owner.actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(
            (after.privateAccess as { hasAccess?: boolean }).hasAccess,
        ).toBe(false);
    });

    it('keeps launching while the hosted subdomain is still owned', async () => {
        const { actor, userId } = await makeUser();
        const sub = uniqueName('live');
        await server.stores.subdomain.create({ userId, subdomain: sub });

        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('app'),
                    title: 'Backed App',
                    index_url: hostedUrl(sub),
                },
            }),
        );

        const result = await withActor(actor, () =>
            driver.read({ uid: created.uid }),
        );
        expect(String(result.index_url)).toContain(sub);
        expect(
            (result.privateAccess as { hasAccess?: boolean } | undefined)
                ?.hasAccess,
        ).not.toBe(false);
    });
});

// -- select: batched #toClient query counts --
//
// Canonical index_url resolution and the hosted-backing check are batched per
// page, so these counts must stay flat as the page grows.

describe('AppDriver.select query-count regression', () => {
    const makeMixedApps = async (count: number) => {
        const { actor, userId } = await makeUser();
        for (let i = 0; i < count; i++) {
            const kind = i % 3;
            if (kind === 0) {
                // Live hosted: owns the subdomain it points at.
                const sub = uniqueName(`qclive${i}`);
                await server.stores.subdomain.create({ userId, subdomain: sub });
                await withActor(actor, () =>
                    driver.create({
                        object: {
                            name: uniqueName(`qc-live-${i}`),
                            title: 't',
                            index_url: `https://${sub}.site.puter.localhost/`,
                        },
                    }),
                );
            } else if (kind === 1) {
                // Dangling hosted: the subdomain is gone by the time we read.
                const sub = uniqueName(`qcdang${i}`);
                const row = await server.stores.subdomain.create({
                    userId,
                    subdomain: sub,
                });
                await withActor(actor, () =>
                    driver.create({
                        object: {
                            name: uniqueName(`qc-dangling-${i}`),
                            title: 't',
                            index_url: `https://${sub}.site.puter.localhost/`,
                        },
                    }),
                );
                await server.stores.subdomain.deleteByUuid(
                    String((row as { uuid: string }).uuid),
                    { userId },
                );
            } else {
                // External, with a path — not puter-hosted at all.
                await withActor(actor, () =>
                    driver.create({
                        object: {
                            name: uniqueName(`qc-ext-${i}`),
                            title: 't',
                            index_url: `${uniqueIndexUrl()}some/path`,
                        },
                    }),
                );
            }
        }
        return actor;
    };

    const countQueriesForSelect = async (actor: Actor) => {
        const read = vi.spyOn(server.clients.db, 'read');
        const pread = vi.spyOn(server.clients.db, 'pread');
        try {
            const items = (await withActor(actor, () =>
                driver.select({ predicate: ['user-can-edit'] }),
            )) as Array<Record<string, unknown>>;
            const counts = { indexUrlIn: 0, subdomains: 0, appsUidEq: 0 };
            for (const call of read.mock.calls) {
                const sql = call[0] as string;
                if (/`index_url`\s+IN\s*\(/i.test(sql)) {
                    counts.indexUrlIn++;
                } else if (sql.includes('`subdomains`')) {
                    counts.subdomains++;
                } else if (
                    sql.includes('`apps`') &&
                    /`uid`\s*=\s*\?/.test(sql)
                ) {
                    counts.appsUidEq++;
                }
            }
            return {
                counts,
                pread: pread.mock.calls.length,
                itemCount: items.length,
            };
        } finally {
            read.mockRestore();
            pread.mockRestore();
        }
    };

    it('keeps index_url / subdomains / per-app-uid query counts constant from 3 apps to 30 apps', async () => {
        const actor3 = await makeMixedApps(3);
        const actor30 = await makeMixedApps(30);

        const small = await countQueriesForSelect(actor3);
        const large = await countQueriesForSelect(actor30);

        expect(small.itemCount).toBe(3);
        expect(large.itemCount).toBe(30);
        // Sanity check the classifier actually saw the shapes it's counting.
        expect(small.counts.indexUrlIn).toBeGreaterThan(0);
        expect(small.counts.subdomains).toBeGreaterThan(0);

        expect(large.counts).toEqual(small.counts);
        expect(large.pread).toBe(small.pread);
    });
});

// -- select / read parity --

describe('AppDriver.select / read parity', () => {
    const findViaBroadSelect = async (
        actor: Actor,
        uid: string,
    ): Promise<Record<string, unknown> | undefined> => {
        let cursor: string | null | undefined = null;
        do {
            const page = (await withActor(actor, () =>
                driver.select({ limit: 50, cursor }),
            )) as { items: Array<Record<string, unknown>>; cursor?: string };
            const found = page.items.find((r) => r.uid === uid);
            if (found) return found;
            cursor = page.cursor;
        } while (cursor);
        return undefined;
    };

    it('every select item (minus stats) deep-equals the corresponding read', async () => {
        const { actor } = await makeUser();
        const names: string[] = [];
        for (let i = 0; i < 4; i++) {
            const name = uniqueName(`parity${i}`);
            names.push(name);
            await withActor(actor, () =>
                driver.create({
                    object: { name, title: 't', index_url: uniqueIndexUrl() },
                }),
            );
        }

        const selectResult = (await withActor(actor, () =>
            driver.select({ predicate: ['user-can-edit'] }),
        )) as Array<Record<string, unknown>>;
        const ours = selectResult.filter((item) =>
            names.includes(item.name as string),
        );
        expect(ours.length).toBe(names.length);

        for (const item of ours) {
            const read = await withActor(actor, () =>
                driver.read({ uid: item.uid as string }),
            );
            const { stats: _itemStats, ...itemRest } = item;
            const { stats: _readStats, ...readRest } = read;
            expect(itemRest).toEqual(readRest);
        }
    });

    it('sets created_from_origin on the canonical hosted row and null on a duplicate', async () => {
        const { actor, userId } = await makeUser();
        const sub = uniqueName('cfo');
        await server.stores.subdomain.create({ userId, subdomain: sub });
        const url = `https://${sub}.site.puter.localhost/`;
        const canonical = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('cfo-canon'),
                    title: 't',
                    index_url: url,
                },
            }),
        );
        // A duplicate row at the same index_url — `create` would normally
        // refuse this; direct insert mirrors the pre-existing-data shape
        // the canonical resolver has to cope with.
        const dupUid = `app-${uuidv4()}`;
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [dupUid, uniqueName('cfo-dup'), 'dup', url, userId],
        );

        const result = (await withActor(actor, () =>
            driver.select({ predicate: ['user-can-edit'] }),
        )) as Array<Record<string, unknown>>;
        const canonItem = result.find((r) => r.uid === canonical.uid);
        const dupItem = result.find((r) => r.uid === dupUid);
        expect(canonItem?.created_from_origin).toBe(
            `https://${sub}.site.puter.localhost`,
        );
        expect(dupItem?.created_from_origin).toBeNull();
    });

    it('gates the canonical-private row: a public duplicate withholds index_url and denies access', async () => {
        const ownerA = await makeUser();
        const ownerB = await makeUser();

        const sharedUrl = uniqueIndexUrl();
        const uidA = `app-${uuidv4()}`;
        const uidB = `app-${uuidv4()}`;
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`, `is_private`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                uidA,
                uniqueName('priv-a'),
                'Private A',
                sharedUrl,
                ownerA.userId,
                1,
            ],
        );
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`, `is_private`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                uidB,
                uniqueName('pub-b'),
                'Public B',
                sharedUrl,
                ownerB.userId,
                0,
            ],
        );

        // B's own owner is not A's owner, so the gate still applies to them.
        const result = (await withActor(ownerB.actor, () =>
            driver.select({ predicate: ['user-can-edit'] }),
        )) as Array<Record<string, unknown>>;
        const bItem = result.find((r) => r.uid === uidB);
        expect(bItem).toBeTruthy();
        expect(bItem!.index_url).toBeUndefined();
        expect(
            (bItem!.privateAccess as { hasAccess?: boolean }).hasAccess,
        ).toBe(false);
    });

    it('dangling hosted app via select: owner keeps index_url, others do not', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const sub = uniqueName('qcdangsel');
        const row = await server.stores.subdomain.create({
            userId: owner.userId,
            subdomain: sub,
        });
        const created = await withActor(owner.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('dangling-sel'),
                    title: 't',
                    index_url: `https://${sub}.site.puter.localhost/`,
                },
            }),
        );
        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId: owner.userId },
        );

        const ownerResult = (await withActor(owner.actor, () =>
            driver.select({ predicate: ['user-can-edit'] }),
        )) as Array<Record<string, unknown>>;
        const ownerItem = ownerResult.find((r) => r.uid === created.uid);
        expect(ownerItem?.index_url).toBe(created.index_url);
        expect(
            (ownerItem?.privateAccess as { reason?: string } | undefined)
                ?.reason,
        ).toBe('hosted_backing_unavailable');

        const otherItem = await findViaBroadSelect(
            other.actor,
            created.uid as string,
        );
        expect(otherItem?.index_url).toBeUndefined();
        expect(
            (otherItem?.privateAccess as { hasAccess?: boolean } | undefined)
                ?.hasAccess,
        ).toBe(false);
    });

    it('a blocked origin resolves created_from_origin to null without select throwing', async () => {
        const { actor } = await makeUser();
        const blockedHost = `blocked-${Math.random().toString(36).slice(2, 10)}.test`;
        const created = await withActor(actor, () =>
            driver.create({
                object: {
                    name: uniqueName('blocked-sel'),
                    title: 't',
                    index_url: `https://${blockedHost}/app`,
                },
            }),
        );
        await server.clients.db.write(
            'INSERT INTO `blocked_app_origins` (`domain`, `include_subdomains`) VALUES (?, ?)',
            [blockedHost, 0],
        );
        (
            server.services.appOriginBlocklist as { invalidate: () => void }
        ).invalidate();

        const result = (await withActor(actor, () =>
            driver.select({ predicate: ['user-can-edit'] }),
        )) as Array<Record<string, unknown>>;
        const item = result.find((r) => r.uid === created.uid);
        expect(item).toBeTruthy();
        expect(item!.created_from_origin).toBeNull();
    });
});

// -- read: prefetched-shaped params cannot be spoofed --

describe('AppDriver.read prefetched-param isolation', () => {
    it('ignores caller-supplied hostedBackingUnavailable/canonical/filetypes on a dangling app', async () => {
        const owner = await makeUser();
        const attacker = await makeUser();
        const sub = uniqueName('sec-dangling');
        const row = await server.stores.subdomain.create({
            userId: owner.userId,
            subdomain: sub,
        });
        const created = await withActor(owner.actor, () =>
            driver.create({
                object: {
                    name: uniqueName('sec-app'),
                    title: 't',
                    index_url: `https://${sub}.site.puter.localhost/`,
                    filetype_associations: ['.puter'],
                },
            }),
        );
        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId: owner.userId },
        );

        const result = await withActor(attacker.actor, () =>
            driver.read({
                uid: created.uid,
                params: {
                    hostedBackingUnavailable: false,
                    canonical: null,
                    filetypes: ['x'],
                },
            }),
        );

        // The spoofed `hostedBackingUnavailable: false` doesn't suppress the
        // real denial, so the dangling app's index_url is still withheld.
        expect(result.index_url).toBeUndefined();
        // The spoofed `filetypes` doesn't override the DB-backed list.
        expect(result.filetype_associations).toEqual(
            expect.arrayContaining(['puter']),
        );
        expect(result.filetype_associations).not.toContain('x');
    });
});

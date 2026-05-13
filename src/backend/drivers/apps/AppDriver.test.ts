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
        expect(created.filetype_associations).toEqual(
            expect.arrayContaining(['.txt', '.md']),
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
        expect(updated.filetype_associations).toEqual(
            expect.arrayContaining(['.md', '.csv']),
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

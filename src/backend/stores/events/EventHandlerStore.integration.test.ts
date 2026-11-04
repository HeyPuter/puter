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

/**
 * Handler CRUD against a real table. What is on the hook is the publish
 * contract: same source is a no-op, different source needs the caller to say
 * which one it is replacing, and the name is scoped to one app.
 */

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
    EVENTS_HANDLERS_PER_APP,
    EVENTS_HANDLER_SOURCE_MAX_BYTES,
    EVENTS_USER_HANDLERS_PER_SCOPE,
} from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    appHandlerScope,
    hashContent,
    type HandlerScope,
} from './EventHandlerStore.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let appUid: string;
let otherAppUid: string;
let ownerUserId: number;
let otherOwnerUserId: number;

const handlers = () => env.server.stores.eventHandler;

const SOURCE = 'async ({ event }) => { console.log(event.path); }';
const OTHER_SOURCE = 'async ({ event, ctx }) => { console.log(ctx.url); }';

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

/**
 * A minimal `apps` row, owned by `ownerUserId`, for the events-workers reads to
 * join against.
 */
const makeApp = async (owner: number): Promise<string> => {
    const uid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, owner],
    );
    return uid;
};

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    appUid = `app-${uuidv4()}`;
    otherAppUid = `app-${uuidv4()}`;

    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    ownerUserId = user!.id;
    const other = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    otherOwnerUserId = other!.id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.db.write('DELETE FROM `event_handlers`', []);
    await env.server.clients.db.write('DELETE FROM `event_user_handlers`', []);
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
    await env.server.clients.db.write('DELETE FROM `apps`', []);
});

describe('publishing a handler', () => {
    it('creates a name that was not there', async () => {
        const { handler, outcome } = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(outcome).toBe('created');
        expect(handler.sourceHash).toBe(hashContent(SOURCE));
        await expect(
            handlers().getByName(appHandlerScope(appUid), 'ingestUpload'),
        ).resolves.toMatchObject({ name: 'ingestUpload', source: SOURCE });
    });

    it('is a no-op when the same source is published again', async () => {
        const first = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });
        const again = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(again.outcome).toBe('unchanged');
        expect(again.handler.updatedAt).toBe(first.handler.updatedAt);
    });

    it('refuses different source from a publisher that did not name the base', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'ingestUpload',
                source: OTHER_SOURCE,
            }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
        await expect(
            handlers().getByName(appHandlerScope(appUid), 'ingestUpload'),
        ).resolves.toMatchObject({ source: SOURCE });
    });

    it('takes the update from a publisher whose base is what is published', async () => {
        const first = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        const updated = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: OTHER_SOURCE,
            ifHash: first.handler.sourceHash,
        });

        expect(updated.outcome).toBe('updated');
        expect(updated.handler.sourceHash).toBe(hashContent(OTHER_SOURCE));
    });

    it('refuses the second of two build steps that both branched from the same base', async () => {
        const base = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: OTHER_SOURCE,
            ifHash: base.handler.sourceHash,
        });

        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'ingestUpload',
                source: 'async () => { /* a third build */ }',
                ifHash: base.handler.sourceHash,
            }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
    });

    it('takes the name outright for a publisher that asked to replace', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        const replaced = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: OTHER_SOURCE,
            replace: true,
        });

        expect(replaced.outcome).toBe('updated');
        expect(replaced.handler.source).toBe(OTHER_SOURCE);
    });

    it('refuses an update whose base is not published at all', async () => {
        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'ingestUpload',
                source: SOURCE,
                ifHash: hashContent(OTHER_SOURCE),
            }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
    });

    it('lets exactly one of two racing different-source updates win', async () => {
        const base = await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        const results = await Promise.allSettled([
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'ingestUpload',
                source: OTHER_SOURCE,
                ifHash: base.handler.sourceHash,
            }),
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'ingestUpload',
                source: 'async () => { /* the other racer */ }',
                ifHash: base.handler.sourceHash,
            }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toSatisfy(
            codeOf('events_handler_conflict'),
        );

        // The row reflects whichever one actually won — never a mix of the
        // two, and never silently both.
        const stored = await handlers().getByName(
            appHandlerScope(appUid),
            'ingestUpload',
        );
        expect([
            OTHER_SOURCE,
            'async () => { /* the other racer */ }',
        ]).toContain(stored!.source);
    });

    it('never lets a create-vs-create race leak a raw database error', async () => {
        const results = await Promise.allSettled([
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'brandNew',
                source: SOURCE,
            }),
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'brandNew',
                source: OTHER_SOURCE,
            }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        // Exactly one side creates the name; racing straight into a UNIQUE
        // index must surface as the same stable conflict a sequential caller
        // gets, never a raw driver error escaping the store.
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toSatisfy(codeOf('events_handler_conflict'));

        const stored = await handlers().getByName(
            appHandlerScope(appUid),
            'brandNew',
        );
        expect([SOURCE, OTHER_SOURCE]).toContain(stored!.source);
    });

    it('scopes the name to one app', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });
        const other = await handlers().publish({
            scope: appHandlerScope(otherAppUid),
            name: 'ingestUpload',
            source: OTHER_SOURCE,
        });

        expect(other.outcome).toBe('created');
        await expect(
            handlers().getByName(appHandlerScope(appUid), 'ingestUpload'),
        ).resolves.toMatchObject({ source: SOURCE });
    });

    it('refuses a name that is not an addressable identifier', async () => {
        for (const name of [
            '',
            ' leading',
            'has space',
            '-dash',
            'x'.repeat(129),
        ]) {
            await expect(
                handlers().publish({
                    scope: appHandlerScope(appUid),
                    name,
                    source: SOURCE,
                }),
            ).rejects.toSatisfy(codeOf('events_handler_name_invalid'));
        }
    });

    it('refuses empty source and source past the cap', async () => {
        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'empty',
                source: '   ',
            }),
        ).rejects.toSatisfy(codeOf('events_handler_source_invalid'));

        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'huge',
                source: 'x'.repeat(EVENTS_HANDLER_SOURCE_MAX_BYTES + 1),
            }),
        ).rejects.toSatisfy(codeOf('events_handler_too_large'));
    });
});

describe('listing handlers', () => {
    it('reports names, hashes and dependents, never source', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'indexDocument',
            source: OTHER_SOURCE,
        });

        const listed = await handlers().listForApp(appHandlerScope(appUid));

        expect(listed.map((row) => row.name)).toEqual([
            'indexDocument',
            'ingestUpload',
        ]);
        expect(listed[1]).toMatchObject({
            name: 'ingestUpload',
            hash: hashContent(SOURCE),
            subscriptions: 0,
        });
        expect(listed.every((row) => !('source' in row))).toBe(true);
    });

    it('counts the subscriptions each name is carrying', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });
        for (const suffix of ['a', 'b']) {
            await env.server.clients.db.write(
                'INSERT INTO `event_subscriptions` (`sub_id`, `token`, `owner_user_id`, ' +
                    '`holder_user_id`, `app_uid`, `subject`, `anchor_uid`, `anchor_path`, ' +
                    '`delivery`, `handler_name`, `targets`, `permission`, `created_at`) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    `${appUid}#${suffix}`,
                    'f#anchor',
                    1,
                    1,
                    appUid,
                    'fs:/x',
                    'anchor',
                    '/x',
                    'single',
                    'ingestUpload',
                    JSON.stringify(['worker']),
                    'list',
                    0,
                ],
            );
        }

        const [listed] = await handlers().listForApp(appHandlerScope(appUid));
        expect(listed.subscriptions).toBe(2);
    });
});

describe('removing a handler', () => {
    it('drops the row and reports what it was', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'ingestUpload',
            source: SOURCE,
        });

        await expect(
            handlers().remove(appHandlerScope(appUid), 'ingestUpload'),
        ).resolves.toMatchObject({ name: 'ingestUpload' });
        await expect(
            handlers().getByName(appHandlerScope(appUid), 'ingestUpload'),
        ).resolves.toBeNull();
    });

    it('answers null for a name the app never published', async () => {
        await expect(
            handlers().remove(appHandlerScope(appUid), 'nothing'),
        ).resolves.toBeNull();
    });
});

describe('deleteForApp', () => {
    it('drops every handler an app published in one call', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'b',
            source: OTHER_SOURCE,
        });

        await expect(handlers().deleteForApp(appUid)).resolves.toBe(2);
        expect(await handlers().listForApp(appHandlerScope(appUid))).toEqual(
            [],
        );
    });

    it('never touches another app`s handlers', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(otherAppUid),
            name: 'a',
            source: SOURCE,
        });

        await handlers().deleteForApp(appUid);
        expect(
            await handlers().listForApp(appHandlerScope(otherAppUid)),
        ).toHaveLength(1);
    });

    it('answers 0 for an app with nothing published', async () => {
        await expect(handlers().deleteForApp(appUid)).resolves.toBe(0);
    });
});

describe('the set a delivery addresses', () => {
    // Its own app per test: the cache outlives the table wipe between tests.
    let cachedApp: string;
    beforeEach(() => {
        cachedApp = `app-${uuidv4()}`;
    });

    const hashesOf = async () =>
        (await handlers().cachedSetForApp(appHandlerScope(cachedApp))).map(
            (handler) => `${handler.name}:${handler.sourceHash}`,
        );

    it('reads the table once, then answers from the cache', async () => {
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
        });
        const pread = vi.spyOn(env.server.clients.db, 'pread');
        try {
            const first = await handlers().cachedSetForApp(
                appHandlerScope(cachedApp),
            );
            const second = await handlers().cachedSetForApp(
                appHandlerScope(cachedApp),
            );

            expect(second).toEqual(first);
            expect(pread).toHaveBeenCalledTimes(1);
            expect(first).toEqual(
                await handlers().setForApp(appHandlerScope(cachedApp)),
            );
        } finally {
            pread.mockRestore();
        }
    });

    it('reads a miss from the replica when asked to, and caches it', async () => {
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
        });
        const pread = vi.spyOn(env.server.clients.db, 'pread');
        const read = vi.spyOn(env.server.clients.db, 'read');
        try {
            const first = await handlers().cachedSetForApp(
                appHandlerScope(cachedApp),
                {
                    missRead: 'replica',
                },
            );
            expect(first.map((h) => h.name)).toEqual(['a']);
            await handlers().cachedSetForApp(appHandlerScope(cachedApp), {
                missRead: 'replica',
            });
            expect(pread).not.toHaveBeenCalled();
            expect(read).toHaveBeenCalledTimes(1);
        } finally {
            pread.mockRestore();
            read.mockRestore();
        }
    });

    it('never hands the delivery path a set a lagging replica read cached', async () => {
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
        });
        const fresh = 'async ({ event }) => event.path';
        // The replica still has the old source when a schedule run reads it,
        // right after a publish dropped the caches.
        const stale = await handlers().setForApp(appHandlerScope(cachedApp));
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: fresh,
            replace: true,
        });
        const read = vi
            .spyOn(env.server.clients.db, 'read')
            .mockResolvedValueOnce(
                stale.map((h) => ({ name: h.name, source_hash: h.sourceHash })),
            );
        try {
            const viaReplica = await handlers().cachedSetForApp(
                appHandlerScope(cachedApp),
                {
                    missRead: 'replica',
                },
            );
            expect(viaReplica[0].sourceHash).toBe(hashContent(SOURCE));
        } finally {
            read.mockRestore();
        }
        const delivery = await handlers().cachedSetForApp(
            appHandlerScope(cachedApp),
        );
        expect(delivery[0].sourceHash).toBe(hashContent(fresh));

        // A publish drops the replica-read entry too.
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
            replace: true,
        });
        const again = await handlers().cachedSetForApp(
            appHandlerScope(cachedApp),
            {
                missRead: 'replica',
            },
        );
        expect(again[0].sourceHash).toBe(hashContent(SOURCE));
    });

    it('checks an empty replica read on the primary', async () => {
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
        });
        // The replica hasn't seen the publish yet.
        const read = vi
            .spyOn(env.server.clients.db, 'read')
            .mockResolvedValueOnce([]);
        const pread = vi.spyOn(env.server.clients.db, 'pread');
        try {
            const set = await handlers().cachedSetForApp(
                appHandlerScope(cachedApp),
                {
                    missRead: 'replica',
                },
            );
            expect(set.map((h) => h.name)).toEqual(['a']);
            expect(pread).toHaveBeenCalledTimes(1);

            // The primary's answer is cached for the next run. (SQLite's
            // `pread` goes through `read`, so count from here.)
            const reads = read.mock.calls.length;
            await handlers().cachedSetForApp(appHandlerScope(cachedApp), {
                missRead: 'replica',
            });
            expect(read).toHaveBeenCalledTimes(reads);
            expect(pread).toHaveBeenCalledTimes(1);
        } finally {
            read.mockRestore();
            pread.mockRestore();
        }
    });

    it('re-reads on the primary a replica set without the handler a run needs', async () => {
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
        });
        const stale = await handlers().setForApp(appHandlerScope(cachedApp));
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'b',
            source: SOURCE,
        });
        // The replica has only `a`, published before `b`.
        const read = vi
            .spyOn(env.server.clients.db, 'read')
            .mockResolvedValueOnce(
                stale.map((h) => ({ name: h.name, source_hash: h.sourceHash })),
            );
        try {
            const set = await handlers().cachedSetForApp(
                appHandlerScope(cachedApp),
                {
                    missRead: 'replica',
                    handlerName: 'b',
                },
            );
            expect(set.map((h) => h.name).sort()).toEqual(['a', 'b']);
        } finally {
            read.mockRestore();
        }
    });

    it('follows every publish and removal', async () => {
        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: SOURCE,
        });
        expect(await hashesOf()).toEqual([`a:${hashContent(SOURCE)}`]);

        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'b',
            source: SOURCE,
        });
        expect(await hashesOf()).toEqual([
            `a:${hashContent(SOURCE)}`,
            `b:${hashContent(SOURCE)}`,
        ]);

        await handlers().publish({
            scope: appHandlerScope(cachedApp),
            name: 'a',
            source: OTHER_SOURCE,
            replace: true,
        });
        expect(await hashesOf()).toEqual([
            `a:${hashContent(OTHER_SOURCE)}`,
            `b:${hashContent(SOURCE)}`,
        ]);

        await handlers().remove(appHandlerScope(cachedApp), 'b');
        expect(await hashesOf()).toEqual([`a:${hashContent(OTHER_SOURCE)}`]);

        await handlers().deleteForApp(cachedApp);
        expect(await hashesOf()).toEqual([]);
    });

    it('never caches an empty set', async () => {
        expect(await hashesOf()).toEqual([]);

        // Behind the store's back, so nothing drops a cached entry.
        await env.server.clients.db.write(
            'INSERT INTO `event_handlers` (`app_uid`, `name`, `source`, `source_hash`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?)',
            [cachedApp, 'a', SOURCE, hashContent(SOURCE), 1, 1],
        );
        expect(await hashesOf()).toEqual([`a:${hashContent(SOURCE)}`]);
    });

    it('tells every peer to drop its copy on a write', async () => {
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            await handlers().publish({
                scope: appHandlerScope(cachedApp),
                name: 'a',
                source: SOURCE,
            });

            expect(emit).toHaveBeenCalledWith(
                'outer.cacheUpdate',
                {
                    cacheKey: [
                        `eventHandlers:set:${cachedApp}`,
                        `eventHandlers:set:${cachedApp}:r`,
                    ],
                },
                {},
            );
        } finally {
            emit.mockRestore();
        }
    });
});

describe('totalSourceBytesForApp', () => {
    it('is zero for an app with nothing published', async () => {
        expect(
            await handlers().totalSourceBytesForApp(appHandlerScope(appUid)),
        ).toBe(0);
    });

    it('sums every handler`s source, and only that app`s', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'b',
            source: OTHER_SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(otherAppUid),
            name: 'a',
            source: SOURCE,
        });

        expect(
            await handlers().totalSourceBytesForApp(appHandlerScope(appUid)),
        ).toBe(
            Buffer.byteLength(SOURCE, 'utf8') +
                Buffer.byteLength(OTHER_SOURCE, 'utf8'),
        );
        expect(
            await handlers().totalSourceBytesForApp(
                appHandlerScope(otherAppUid),
            ),
        ).toBe(Buffer.byteLength(SOURCE, 'utf8'));
    });

    it('drops back down once a handler is removed', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().remove(appHandlerScope(appUid), 'a');
        expect(
            await handlers().totalSourceBytesForApp(appHandlerScope(appUid)),
        ).toBe(0);
    });

    it('counts bytes, not characters, for multibyte source', async () => {
        const source = 'async () => { console.log("日本語 — ✨"); }';
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source,
        });

        expect(
            await handlers().totalSourceBytesForApp(appHandlerScope(appUid)),
        ).toBe(Buffer.byteLength(source, 'utf8'));
        expect(Buffer.byteLength(source, 'utf8')).toBeGreaterThan(
            source.length,
        );
    });
});

describe('counting an owner`s apps with published handlers', () => {
    it('is zero for an owner with nothing published', async () => {
        await makeApp(ownerUserId);
        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId),
        ).toBe(0);
    });

    it('counts distinct apps, not handlers', async () => {
        const uid = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'b',
            source: SOURCE,
        });

        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId),
        ).toBe(1);
    });

    it('scopes to the owner, not other accounts` apps', async () => {
        const mine = await makeApp(ownerUserId);
        const theirs = await makeApp(otherOwnerUserId);
        await handlers().publish({
            scope: appHandlerScope(mine),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(theirs),
            name: 'a',
            source: SOURCE,
        });

        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId),
        ).toBe(1);
        expect(
            await handlers().countAppsWithHandlersForOwner(otherOwnerUserId),
        ).toBe(1);
    });

    it('with createdBefore, counts only apps whose earliest handler predates it', async () => {
        const early = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(early),
            name: 'a',
            source: SOURCE,
        });

        // `created_at` is unix seconds, so the cutoff and the later publish
        // each need a full second of clearance to land in a different bucket.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const cutoff = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 1100));

        const late = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(late),
            name: 'a',
            source: SOURCE,
        });

        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId, {
                createdBefore: cutoff,
            }),
        ).toBe(1);
        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId),
        ).toBe(2);
    });

    it('reads createdBefore as an exact millisecond boundary', async () => {
        const uid = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'a',
            source: SOURCE,
        });
        const [row] = await env.server.clients.db.read(
            'SELECT `created_at` FROM `event_handlers` WHERE `app_uid` = ?',
            [uid],
        );
        const createdAtMs = Number(row.created_at) * 1000;

        const count = (createdBefore: number) =>
            handlers().countAppsWithHandlersForOwner(ownerUserId, {
                createdBefore,
            });

        // Strictly before: the instant the handler was created is not before
        // itself, and one millisecond past it is.
        await expect(count(createdAtMs)).resolves.toBe(0);
        await expect(count(createdAtMs + 1)).resolves.toBe(1);
        await expect(count(createdAtMs + 999)).resolves.toBe(1);
    });
});

describe('listing an owner`s events workers', () => {
    it('reports one row per app, with its handler count and app details', async () => {
        const uid = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'b',
            source: OTHER_SOURCE,
        });

        const page = await handlers().listEventsWorkersForOwner(ownerUserId);

        expect(page.items).toEqual([
            expect.objectContaining({
                appUid: uid,
                appName: uid,
                appTitle: uid,
                handlerCount: 2,
            }),
        ]);
        expect(page.cursor).toBeUndefined();
    });

    it('never lists an app that is not this owner`s', async () => {
        const theirs = await makeApp(otherOwnerUserId);
        await handlers().publish({
            scope: appHandlerScope(theirs),
            name: 'a',
            source: SOURCE,
        });

        const page = await handlers().listEventsWorkersForOwner(ownerUserId);
        expect(page.items).toEqual([]);
    });

    it('narrows to one app with the `appUid` option', async () => {
        const uidA = await makeApp(ownerUserId);
        const uidB = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(uidA),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(uidB),
            name: 'b',
            source: OTHER_SOURCE,
        });

        const page = await handlers().listEventsWorkersForOwner(ownerUserId, {
            appUid: uidA,
        });
        expect(page.items).toEqual([expect.objectContaining({ appUid: uidA })]);
    });

    it('finds nothing for an `appUid` this owner does not hold', async () => {
        const uid = await makeApp(ownerUserId);
        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'a',
            source: SOURCE,
        });
        const theirs = await makeApp(otherOwnerUserId);
        await handlers().publish({
            scope: appHandlerScope(theirs),
            name: 'a',
            source: SOURCE,
        });

        const page = await handlers().listEventsWorkersForOwner(ownerUserId, {
            appUid: theirs,
        });
        expect(page.items).toEqual([]);
    });

    it('paginates with a cursor, keyset on app_uid', async () => {
        const uids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const uid = await makeApp(ownerUserId);
            await handlers().publish({
                scope: appHandlerScope(uid),
                name: 'a',
                source: SOURCE,
            });
            uids.push(uid);
        }

        const first = await handlers().listEventsWorkersForOwner(ownerUserId, {
            limit: 2,
        });
        expect(first.items).toHaveLength(2);
        expect(first.cursor).toBeDefined();

        const second = await handlers().listEventsWorkersForOwner(ownerUserId, {
            limit: 2,
            cursor: first.cursor,
        });
        expect(second.items).toHaveLength(1);
        expect(second.cursor).toBeUndefined();

        expect(
            [...first.items, ...second.items].map((row) => row.appUid).sort(),
        ).toEqual([...uids].sort());
    });
});

describe('user scopes', () => {
    const userScope = (app: string, holder: number): HandlerScope => ({
        appUid: app,
        holder,
    });
    const HOLDER_A = 9001;
    const HOLDER_B = 9002;
    const inlineName = (source: string) => `@${hashContent(source)}`;

    const bind = async (
        holder: number,
        app: string,
        name: string,
        handlerScope: 'app' | 'user',
        over: { suspended?: boolean } = {},
    ) => {
        const { row } = await env.server.stores.durableSubscription.create({
            holderUserId: ownerUserId,
            ownerUserId,
            appUid: app,
            subject: 'fs:/x',
            token: `f#${uuidv4()}`,
            anchorUid: 'anchor',
            anchorPath: '/x',
            match: null,
            op: null,
            delivery: 'single',
            handlerName: name,
            handlerScope,
            context: null,
            permission: 'list',
            expiresAt: null,
        });
        // The rows above are the owner's; move them to the scope's holder.
        await env.server.clients.db.write(
            'UPDATE `event_subscriptions` SET `holder_user_id` = ? WHERE `sub_id` = ?',
            [holder, row.subId],
        );
        if (over.suspended)
            await env.server.clients.db.write(
                'UPDATE `event_subscriptions` SET `suspended_at` = 1, `suspended_reason` = ? WHERE `sub_id` = ?',
                ['handler_not_found', row.subId],
            );
        return row;
    };

    it('publishes, reads, lists and removes inside one scope', async () => {
        const scope = userScope(appUid, HOLDER_A);
        const { outcome } = await handlers().publish({
            scope,
            name: 'daily',
            source: SOURCE,
        });
        expect(outcome).toBe('created');

        await expect(
            handlers().getByName(scope, 'daily'),
        ).resolves.toMatchObject({ name: 'daily', source: SOURCE });
        // A user scope's entries say when each handler was last touched.
        expect(await handlers().setForApp(scope)).toEqual([
            {
                name: 'daily',
                sourceHash: hashContent(SOURCE),
                updatedAt: expect.any(Number),
            },
        ]);
        expect((await handlers().allForApp(scope)).map((h) => h.name)).toEqual([
            'daily',
        ]);
        expect(await handlers().countForApp(scope)).toBe(1);
        expect(await handlers().totalSourceBytesForApp(scope)).toBe(
            Buffer.byteLength(SOURCE),
        );
        expect(await handlers().listForApp(scope)).toEqual([
            expect.objectContaining({ name: 'daily', subscriptions: 0 }),
        ]);

        await expect(handlers().remove(scope, 'daily')).resolves.toMatchObject({
            name: 'daily',
        });
        expect(await handlers().countForApp(scope)).toBe(0);
    });

    it('lets one name live in the app scope and in each holder scope', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'daily',
            source: SOURCE,
        });
        await handlers().publish({
            scope: userScope(appUid, HOLDER_A),
            name: 'daily',
            source: OTHER_SOURCE,
        });
        await handlers().publish({
            scope: userScope(appUid, HOLDER_B),
            name: 'daily',
            source: `${SOURCE} // b`,
        });

        const sourceOf = async (scope: HandlerScope) =>
            (await handlers().getByName(scope, 'daily'))?.source;
        expect(await sourceOf(appHandlerScope(appUid))).toBe(SOURCE);
        expect(await sourceOf(userScope(appUid, HOLDER_A))).toBe(OTHER_SOURCE);
        expect(await sourceOf(userScope(appUid, HOLDER_B))).toBe(
            `${SOURCE} // b`,
        );
        // Never in the app's own table.
        expect(await handlers().countForApp(appHandlerScope(appUid))).toBe(1);
    });

    it('never shows one scope another scope or an app handler', async () => {
        await handlers().publish({
            scope: userScope(appUid, HOLDER_A),
            name: 'mine',
            source: SOURCE,
        });
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'shared',
            source: SOURCE,
        });

        expect(await handlers().setForApp(appHandlerScope(appUid))).toEqual([
            { name: 'shared', sourceHash: hashContent(SOURCE) },
        ]);
        expect(await handlers().setForApp(userScope(appUid, HOLDER_B))).toEqual(
            [],
        );
        await expect(
            handlers().getByName(userScope(appUid, HOLDER_B), 'mine'),
        ).resolves.toBeNull();
        await expect(
            handlers().getByName(userScope(appUid, HOLDER_A), 'shared'),
        ).resolves.toBeNull();
        await expect(
            handlers().remove(userScope(appUid, HOLDER_B), 'mine'),
        ).resolves.toBeNull();
        await expect(
            handlers().getByName(userScope(appUid, HOLDER_A), 'mine'),
        ).resolves.not.toBeNull();
    });

    it('maps a unique violation in one scope to events_handler_conflict', async () => {
        const scope = userScope(appUid, HOLDER_A);
        await handlers().publish({ scope, name: 'daily', source: SOURCE });
        await expect(
            handlers().publish({ scope, name: 'daily', source: OTHER_SOURCE }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
        // The same name in another scope is not a conflict.
        await expect(
            handlers().publish({
                scope: userScope(appUid, HOLDER_B),
                name: 'daily',
                source: OTHER_SOURCE,
            }),
        ).resolves.toMatchObject({ outcome: 'created' });

        // The index decides a lost create race, not the read before it.
        const raw = (scope: string) =>
            env.server.clients.db.write(
                'INSERT INTO `event_user_handlers` (`app_uid`, `holder_user_id`, `name`, `source`, `source_hash`, `created_at`, `updated_at`, `scope_since`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [appUid, HOLDER_A, scope, SOURCE, hashContent(SOURCE), 1, 1, 1],
            );
        await expect(raw('daily')).rejects.toThrow();
    });

    it('caps handlers per scope: 20 for a user, 100 for an app', async () => {
        expect(EVENTS_USER_HANDLERS_PER_SCOPE).toBe(20);
        const scope = userScope(appUid, HOLDER_A);
        for (let i = 0; i < EVENTS_USER_HANDLERS_PER_SCOPE; i++)
            await handlers().publish({
                scope,
                name: `h${i}`,
                source: `${SOURCE} // ${i}`,
            });
        await expect(
            handlers().publish({ scope, name: 'one-more', source: SOURCE }),
        ).rejects.toSatisfy(codeOf('events_handler_limit'));
        // Another holder, and the app scope, are unaffected.
        await expect(
            handlers().publish({
                scope: userScope(appUid, HOLDER_B),
                name: 'h0',
                source: SOURCE,
            }),
        ).resolves.toMatchObject({ outcome: 'created' });
        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'h0',
                source: SOURCE,
            }),
        ).resolves.toMatchObject({ outcome: 'created' });
        // Updating at the cap is not a create.
        await expect(
            handlers().publish({
                scope,
                name: 'h0',
                source: OTHER_SOURCE,
                replace: true,
            }),
        ).resolves.toMatchObject({ outcome: 'updated' });

        expect(EVENTS_HANDLERS_PER_APP).toBe(100);
        for (let i = 0; i < EVENTS_HANDLERS_PER_APP - 1; i++)
            await handlers().publish({
                scope: appHandlerScope(appUid),
                name: `a${i}`,
                source: `${SOURCE} // ${i}`,
            });
        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'one-more',
                source: SOURCE,
            }),
        ).rejects.toSatisfy(codeOf('events_handler_limit'));
    });

    it('accepts @<sha256> names in a user scope only', async () => {
        const name = inlineName(SOURCE);
        await expect(
            handlers().publish({
                scope: userScope(appUid, HOLDER_A),
                name,
                source: SOURCE,
            }),
        ).resolves.toMatchObject({ outcome: 'created' });
        await expect(
            handlers().publish({
                scope: appHandlerScope(appUid),
                name,
                source: SOURCE,
            }),
        ).rejects.toSatisfy(codeOf('events_handler_name_invalid'));
        // Only the minted shape: `@` alone, or `@` and anything else, is out.
        for (const bad of ['@', '@abc', `${name}0`, `@${'G'.repeat(64)}`])
            await expect(
                handlers().publish({
                    scope: userScope(appUid, HOLDER_A),
                    name: bad,
                    source: SOURCE,
                }),
            ).rejects.toSatisfy(codeOf('events_handler_name_invalid'));
    });

    it('keeps app-scope cache keys and gives each user scope its own', async () => {
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            const a = userScope(appUid, HOLDER_A);
            await handlers().publish({ scope: a, name: 'x', source: SOURCE });
            expect(emit).toHaveBeenCalledWith(
                'outer.cacheUpdate',
                {
                    cacheKey: [
                        `eventHandlers:uset:${appUid}:${HOLDER_A}`,
                        `eventHandlers:uset:${appUid}:${HOLDER_A}:r`,
                    ],
                },
                {},
            );
            emit.mockClear();
            await handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'x',
                source: SOURCE,
            });
            expect(emit).toHaveBeenCalledWith(
                'outer.cacheUpdate',
                {
                    cacheKey: [
                        `eventHandlers:set:${appUid}`,
                        `eventHandlers:set:${appUid}:r`,
                    ],
                },
                {},
            );
        } finally {
            emit.mockRestore();
        }
    });

    it("does not clear another scope's cached set on a write", async () => {
        const a = userScope(appUid, HOLDER_A);
        const b = userScope(appUid, HOLDER_B);
        const app = appHandlerScope(appUid);
        for (const scope of [a, b, app])
            await handlers().publish({ scope, name: 'x', source: SOURCE });
        for (const scope of [a, b, app])
            await handlers().cachedSetForApp(scope);

        const redis = env.server.clients.redis;
        const keys = [
            `eventHandlers:uset:${appUid}:${HOLDER_A}`,
            `eventHandlers:uset:${appUid}:${HOLDER_B}`,
            `eventHandlers:set:${appUid}`,
        ];
        for (const key of keys) expect(await redis.get(key)).not.toBeNull();

        await handlers().publish({
            scope: a,
            name: 'y',
            source: OTHER_SOURCE,
        });
        expect(await redis.get(keys[0]!)).toBeNull();
        expect(await redis.get(keys[1]!)).not.toBeNull();
        expect(await redis.get(keys[2]!)).not.toBeNull();
    });

    it('skips the peer broadcast for a create that asks to, never for an update', async () => {
        const scope = userScope(appUid, HOLDER_A);
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            await handlers().publish({
                scope,
                name: 'x',
                source: SOURCE,
                broadcast: false,
            });
            expect(emit).not.toHaveBeenCalledWith(
                'outer.cacheUpdate',
                expect.anything(),
                expect.anything(),
            );
            await handlers().publish({
                scope,
                name: 'x',
                source: OTHER_SOURCE,
                replace: true,
                broadcast: false,
            });
            expect(emit).toHaveBeenCalledWith(
                'outer.cacheUpdate',
                expect.anything(),
                {},
            );
        } finally {
            emit.mockRestore();
        }
    });

    it('counts subscriptions per scope, by scope flag and holder', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'daily',
            source: SOURCE,
        });
        await handlers().publish({
            scope: userScope(appUid, ownerUserId),
            name: 'daily',
            source: SOURCE,
        });
        await bind(ownerUserId, appUid, 'daily', 'app');
        await bind(ownerUserId, appUid, 'daily', 'user');
        await bind(ownerUserId, appUid, 'daily', 'user', { suspended: true });
        await bind(otherOwnerUserId, appUid, 'daily', 'user');

        expect(
            await handlers().countSubscriptionsByHandler(
                appHandlerScope(appUid),
            ),
        ).toEqual(new Map([['daily', 1]]));
        expect(
            await handlers().countSubscriptionsByHandler(
                userScope(appUid, ownerUserId),
            ),
        ).toEqual(new Map([['daily', 2]]));
        expect(
            await handlers().listForApp(userScope(appUid, ownerUserId)),
        ).toEqual([expect.objectContaining({ subscriptions: 2 })]);
    });

    it('deleteForApp removes every scope of the app and no other app', async () => {
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: userScope(appUid, HOLDER_A),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: userScope(appUid, HOLDER_B),
            name: 'a',
            source: SOURCE,
        });
        await handlers().publish({
            scope: userScope(otherAppUid, HOLDER_A),
            name: 'a',
            source: SOURCE,
        });

        await expect(handlers().deleteForApp(appUid)).resolves.toBe(3);
        expect(await handlers().countForApp(appHandlerScope(appUid))).toBe(0);
        expect(await handlers().countForApp(userScope(appUid, HOLDER_A))).toBe(
            0,
        );
        expect(await handlers().countForApp(userScope(appUid, HOLDER_B))).toBe(
            0,
        );
        expect(
            await handlers().countForApp(userScope(otherAppUid, HOLDER_A)),
        ).toBe(1);
    });

    it('deletes one scope, or every scope a holder has', async () => {
        for (const [app, holder] of [
            [appUid, HOLDER_A],
            [otherAppUid, HOLDER_A],
            [appUid, HOLDER_B],
        ] as const)
            for (const name of ['a', 'b'])
                await handlers().publish({
                    scope: userScope(app, holder),
                    name,
                    source: `${SOURCE} // ${name}`,
                });

        await expect(
            handlers().deleteUserScope(appUid, HOLDER_A),
        ).resolves.toBe(2);
        expect(
            await handlers().countForApp(userScope(otherAppUid, HOLDER_A)),
        ).toBe(2);
        expect(await handlers().countForApp(userScope(appUid, HOLDER_B))).toBe(
            2,
        );
        // Holder 0 is the app scope, which this never touches.
        await handlers().publish({
            scope: appHandlerScope(appUid),
            name: 'a',
            source: SOURCE,
        });
        await expect(handlers().deleteUserScope(appUid, 0)).resolves.toBe(0);
        expect(await handlers().countForApp(appHandlerScope(appUid))).toBe(1);

        await expect(
            handlers().deleteUserScopesForHolder(HOLDER_A),
        ).resolves.toBe(2);
        expect(
            await handlers().countForApp(userScope(otherAppUid, HOLDER_A)),
        ).toBe(0);
        expect(await handlers().countForApp(userScope(appUid, HOLDER_B))).toBe(
            2,
        );
        await expect(handlers().deleteUserScopesForHolder(0)).resolves.toBe(0);
    });

    it('lists the user scopes of an app by holder, keyset', async () => {
        for (const holder of [HOLDER_B, HOLDER_A, HOLDER_B + 1])
            await handlers().publish({
                scope: userScope(appUid, holder),
                name: 'a',
                source: SOURCE,
            });
        await handlers().publish({
            scope: userScope(appUid, HOLDER_A),
            name: 'b',
            source: OTHER_SOURCE,
        });
        await handlers().publish({
            scope: userScope(otherAppUid, HOLDER_A),
            name: 'a',
            source: SOURCE,
        });

        const all = await handlers().listUserScopes(appUid);
        expect(all.cursor).toBeNull();
        expect(
            all.items.map((scope) => [scope.holder, scope.handlerCount]),
        ).toEqual([
            [HOLDER_A, 2],
            [HOLDER_B, 1],
            [HOLDER_B + 1, 1],
        ]);
        const seen: number[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 10; guard++) {
            const page = await handlers().listUserScopes(appUid, {
                limit: 1,
                cursor,
            });
            expect(page.items).toHaveLength(1);
            seen.push(page.items[0]!.holder);
            if (page.cursor === null) break;
            cursor = page.cursor;
        }
        expect(seen).toEqual([HOLDER_A, HOLDER_B, HOLDER_B + 1]);
    });

    it('refuses a create that raced past the cap, and keeps the scope at 20 or fewer', async () => {
        const scope = userScope(appUid, HOLDER_A);
        for (let i = 0; i < EVENTS_USER_HANDLERS_PER_SCOPE - 1; i++)
            await handlers().publish({
                scope,
                name: `h${i}`,
                source: `${SOURCE} // ${i}`,
            });

        // Hold both creates at the insert, so both passed the count first.
        const db = env.server.clients.db;
        const insert = db.insert.bind(db);
        let arrived = 0;
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => (release = resolve));
        const spy = vi
            .spyOn(db, 'insert')
            .mockImplementation(async (table, row, ...rest) => {
                if (table === 'event_user_handlers') {
                    arrived += 1;
                    if (arrived === 2) release();
                    await barrier;
                }
                return insert(table, row, ...rest);
            });
        let results: PromiseSettledResult<unknown>[];
        try {
            results = await Promise.allSettled([
                handlers().publish({ scope, name: 'x', source: SOURCE }),
                handlers().publish({ scope, name: 'y', source: OTHER_SOURCE }),
            ]);
        } finally {
            spy.mockRestore();
        }

        expect(await handlers().countForApp(scope)).toBeLessThanOrEqual(
            EVENTS_USER_HANDLERS_PER_SCOPE,
        );
        for (const [i, name] of ['x', 'y'].entries()) {
            const stored = await handlers().getByName(scope, name);
            if (results[i]!.status === 'fulfilled')
                expect(stored).not.toBeNull();
            else {
                expect(stored).toBeNull();
                expect((results[i] as PromiseRejectedResult).reason).toSatisfy(
                    codeOf('events_handler_limit'),
                );
            }
        }
        expect(
            results.filter((result) => result.status === 'rejected').length,
        ).toBeGreaterThanOrEqual(1);
    });

    it('drops every user scope cached set when the app is deleted', async () => {
        const redis = env.server.clients.redis;
        const scopes = [HOLDER_A, HOLDER_B].map((h) => userScope(appUid, h));
        for (const scope of scopes) {
            await handlers().publish({ scope, name: 'x', source: SOURCE });
            expect(await handlers().cachedSetForApp(scope)).toHaveLength(1);
        }
        const emit = vi.spyOn(env.server.clients.event, 'emit');
        try {
            await handlers().deleteForApp(appUid);
            expect(emit).toHaveBeenCalledWith(
                'outer.cacheUpdate',
                {
                    cacheKey: expect.arrayContaining(
                        scopes.flatMap((scope) => [
                            `eventHandlers:uset:${appUid}:${scope.holder}`,
                            `eventHandlers:uset:${appUid}:${scope.holder}:r`,
                        ]),
                    ),
                },
                {},
            );
        } finally {
            emit.mockRestore();
        }
        for (const scope of scopes) {
            expect(
                await redis.get(`eventHandlers:uset:${appUid}:${scope.holder}`),
            ).toBeNull();
            expect(await handlers().cachedSetForApp(scope)).toEqual([]);
        }
    });

    describe('what a user holds', () => {
        it('lists one item per app with total, paginated', async () => {
            const apps = [
                await makeApp(ownerUserId),
                await makeApp(ownerUserId),
                await makeApp(ownerUserId),
            ];
            for (const app of apps)
                await handlers().publish({
                    scope: userScope(app, HOLDER_A),
                    name: 'a',
                    source: SOURCE,
                });
            await handlers().publish({
                scope: userScope(apps[0]!, HOLDER_A),
                name: 'b',
                source: OTHER_SOURCE,
            });
            await handlers().publish({
                scope: userScope(apps[0]!, HOLDER_B),
                name: 'a',
                source: SOURCE,
            });

            const first = await handlers().listUserScopesForUser(HOLDER_A, {
                limit: 2,
            });
            expect(first.total).toBe(3);
            expect(first.items).toHaveLength(2);
            expect(first.cursor).toBeDefined();
            const second = await handlers().listUserScopesForUser(HOLDER_A, {
                limit: 2,
                cursor: first.cursor,
            });
            expect(second.items).toHaveLength(1);
            expect(second.cursor).toBeUndefined();

            const items = [...first.items, ...second.items];
            expect(items.map((item) => item.appUid).sort()).toEqual(
                [...apps].sort(),
            );
            expect(items.find((item) => item.appUid === apps[0])).toMatchObject(
                {
                    handlerCount: 2,
                    appName: apps[0],
                },
            );

            const narrowed = await handlers().listUserScopesForUser(HOLDER_A, {
                appUid: apps[1],
            });
            expect(narrowed.items.map((item) => item.appUid)).toEqual([
                apps[1],
            ]);
            expect(narrowed.total).toBe(1);
        });

        it('keeps a scope whose app row is gone, with no name', async () => {
            await handlers().publish({
                scope: userScope(appUid, HOLDER_A),
                name: 'a',
                source: SOURCE,
            });
            const page = await handlers().listUserScopesForUser(HOLDER_A);
            expect(page.items).toEqual([
                expect.objectContaining({ appUid, appName: '', appTitle: '' }),
            ]);
        });

        it("keeps a scope's age when its oldest handler is replaced", async () => {
            const scope = userScope(appUid, HOLDER_A);
            const OCT = 1_760_000_000;
            const NOV_1_MS = 1_762_000_000_000;
            await handlers().publish({ scope, name: 'old', source: SOURCE });
            await env.server.clients.db.write(
                'UPDATE `event_user_handlers` SET `created_at` = ?, `updated_at` = ?, `scope_since` = ?',
                [OCT, OCT, OCT],
            );
            // New code ships in November and GC drops the October handler.
            await handlers().publish({
                scope,
                name: 'new',
                source: OTHER_SOURCE,
            });
            await expect(
                handlers().deleteUserHandlerIfUnbound(
                    scope,
                    'old',
                    Math.floor(Date.now() / 1000),
                ),
            ).resolves.toBe(true);

            expect(await handlers().countForApp(scope)).toBe(1);
            expect(
                await handlers().countUserScopesWithHandlersForUser(HOLDER_A, {
                    createdBefore: NOV_1_MS,
                }),
            ).toBe(1);
        });

        it("restarts a scope's age when it empties and is created again", async () => {
            const scope = userScope(appUid, HOLDER_A);
            const OCT = 1_760_000_000;
            await handlers().publish({ scope, name: 'old', source: SOURCE });
            await env.server.clients.db.write(
                'UPDATE `event_user_handlers` SET `scope_since` = ?',
                [OCT],
            );
            await handlers().remove(scope, 'old');
            await handlers().publish({ scope, name: 'again', source: SOURCE });

            expect(
                await handlers().countUserScopesWithHandlersForUser(HOLDER_A, {
                    createdBefore: 1_762_000_000_000,
                }),
            ).toBe(0);
            const [row] = await env.server.clients.db.read(
                'SELECT `scope_since`, `created_at` FROM `event_user_handlers`',
            );
            expect(Number(row!.scope_since)).toBe(Number(row!.created_at));
        });

        it('counts scopes for rent, honouring createdBefore', async () => {
            const early = await makeApp(ownerUserId);
            const late = await makeApp(ownerUserId);
            await handlers().publish({
                scope: userScope(early, HOLDER_A),
                name: 'a',
                source: SOURCE,
            });
            await handlers().publish({
                scope: userScope(late, HOLDER_A),
                name: 'a',
                source: SOURCE,
            });
            await handlers().publish({
                scope: userScope(late, HOLDER_B),
                name: 'a',
                source: SOURCE,
            });
            await env.server.clients.db.write(
                'UPDATE `event_user_handlers` SET `created_at` = ?, `scope_since` = ? WHERE `app_uid` = ?',
                [1_000, 1_000, early],
            );
            // A later handler does not move the scope's age.
            await handlers().publish({
                scope: userScope(late, HOLDER_A),
                name: 'b',
                source: OTHER_SOURCE,
            });

            expect(
                await handlers().countUserScopesWithHandlersForUser(HOLDER_A),
            ).toBe(2);
            expect(
                await handlers().countUserScopesWithHandlersForUser(HOLDER_A, {
                    createdBefore: 2_000_000,
                }),
            ).toBe(1);
            // Strictly before: created_at 1000s is not before 1_000_000 ms.
            expect(
                await handlers().countUserScopesWithHandlersForUser(HOLDER_A, {
                    createdBefore: 1_000_000,
                }),
            ).toBe(0);
            expect(
                await handlers().countUserScopesWithHandlersForUser(424242),
            ).toBe(0);
        });
    });

    it('keeps owner counts and owner listings on the apps` own sets', async () => {
        const uid = await makeApp(ownerUserId);
        await handlers().publish({
            scope: userScope(uid, otherOwnerUserId),
            name: 'a',
            source: SOURCE,
        });
        // The owner's own user scope in their own app is still not the app's.
        await handlers().publish({
            scope: userScope(uid, ownerUserId),
            name: 'a',
            source: SOURCE,
        });

        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId),
        ).toBe(0);
        expect(
            (await handlers().listEventsWorkersForOwner(ownerUserId)).items,
        ).toEqual([]);

        await handlers().publish({
            scope: appHandlerScope(uid),
            name: 'a',
            source: SOURCE,
        });
        expect(
            await handlers().countAppsWithHandlersForOwner(ownerUserId),
        ).toBe(1);
        const [worker] = (
            await handlers().listEventsWorkersForOwner(ownerUserId)
        ).items;
        expect(worker).toMatchObject({ appUid: uid, handlerCount: 1 });
    });

    describe('the unbound-handler sweep', () => {
        const OLD = 1_000;
        const age = (app: string, holder: number, at: number) =>
            env.server.clients.db.write(
                'UPDATE `event_user_handlers` SET `updated_at` = ? WHERE `app_uid` = ? AND `holder_user_id` = ?',
                [at, app, holder],
            );
        const now = () => Math.floor(Date.now() / 1000);

        it('finds old handlers no row of any state is bound to', async () => {
            const bound = userScope(appUid, ownerUserId);
            const suspended = userScope(appUid, otherOwnerUserId);
            const unbound = userScope(otherAppUid, ownerUserId);
            const fresh = userScope(otherAppUid, otherOwnerUserId);
            for (const scope of [bound, suspended, unbound, fresh])
                await handlers().publish({
                    scope,
                    name: 'a',
                    source: SOURCE,
                });
            for (const scope of [bound, suspended, unbound])
                await age(scope.appUid, scope.holder, OLD);
            await bind(ownerUserId, appUid, 'a', 'user');
            await bind(otherOwnerUserId, appUid, 'a', 'user', {
                suspended: true,
            });
            // An app-scope row of the same name binds nothing here.
            await bind(ownerUserId, otherAppUid, 'a', 'app');

            const { items } = await handlers().listUnboundUserHandlers(
                now() - 60,
            );
            expect(
                items.map((item) => [item.appUid, item.holder, item.name]),
            ).toEqual([[otherAppUid, ownerUserId, 'a']]);
        });

        it('pages by id and ends with a null cursor', async () => {
            for (let holder = 100; holder < 105; holder++) {
                await handlers().publish({
                    scope: userScope(appUid, holder),
                    name: 'a',
                    source: SOURCE,
                });
                await age(appUid, holder, OLD);
            }
            const seen: number[] = [];
            let cursor: string | undefined;
            for (let guard = 0; guard < 10; guard++) {
                const page = await handlers().listUnboundUserHandlers(now(), {
                    cursor,
                    limit: 2,
                });
                seen.push(...page.items.map((item) => item.holder));
                if (page.cursor === null) break;
                cursor = page.cursor;
            }
            expect(seen).toEqual([100, 101, 102, 103, 104]);
        });

        it('refuses to delete a handler bound or touched since it was listed', async () => {
            const scope = userScope(appUid, ownerUserId);
            await handlers().publish({ scope, name: 'a', source: SOURCE });
            await age(appUid, ownerUserId, OLD);

            await bind(ownerUserId, appUid, 'a', 'user');
            await expect(
                handlers().deleteUserHandlerIfUnbound(scope, 'a', now() - 60),
            ).resolves.toBe(false);
            expect(await handlers().countForApp(scope)).toBe(1);

            await env.server.clients.db.write(
                'DELETE FROM `event_subscriptions`',
                [],
            );
            await expect(
                handlers().deleteUserHandlerIfUnbound(scope, 'a', OLD - 1),
            ).resolves.toBe(false);
            await expect(
                handlers().deleteUserHandlerIfUnbound(scope, 'a', now() - 60),
            ).resolves.toBe(true);
            expect(await handlers().countForApp(scope)).toBe(0);
        });

        it('drops the scope cache on both keys, and tells peers, when it deletes', async () => {
            const scope = userScope(appUid, HOLDER_A);
            await handlers().publish({ scope, name: 'a', source: SOURCE });
            await handlers().cachedSetForApp(scope);
            await handlers().cachedSetForApp(scope, { missRead: 'replica' });
            const key = `eventHandlers:uset:${appUid}:${HOLDER_A}`;
            const redis = env.server.clients.redis;
            expect(await redis.get(key)).not.toBeNull();
            expect(await redis.get(`${key}:r`)).not.toBeNull();
            await age(appUid, HOLDER_A, OLD);

            const emit = vi.spyOn(env.server.clients.event, 'emit');
            try {
                await expect(
                    handlers().deleteUserHandlerIfUnbound(
                        scope,
                        'a',
                        now() - 60,
                    ),
                ).resolves.toBe(true);
                expect(emit).toHaveBeenCalledWith(
                    'outer.cacheUpdate',
                    { cacheKey: [key, `${key}:r`] },
                    {},
                );
            } finally {
                emit.mockRestore();
            }
            expect(await redis.get(key)).toBeNull();
            expect(await redis.get(`${key}:r`)).toBeNull();
            expect(await handlers().cachedSetForApp(scope)).toEqual([]);
        });

        it('never touches app-scope handlers', async () => {
            await handlers().publish({
                scope: appHandlerScope(appUid),
                name: 'a',
                source: SOURCE,
            });
            await env.server.clients.db.write(
                'UPDATE `event_handlers` SET `updated_at` = ?',
                [OLD],
            );
            expect(
                (await handlers().listUnboundUserHandlers(now())).items,
            ).toEqual([]);
            await expect(
                handlers().deleteUserHandlerIfUnbound(
                    appHandlerScope(appUid),
                    'a',
                    now(),
                ),
            ).resolves.toBe(false);
            expect(await handlers().countForApp(appHandlerScope(appUid))).toBe(
                1,
            );
        });
    });
});

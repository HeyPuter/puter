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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EVENTS_HANDLER_SOURCE_MAX_BYTES } from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { hashContent } from './EventHandlerStore.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let appUid: string;
let otherAppUid: string;

const handlers = () => env.server.stores.eventHandler;

const SOURCE = 'async ({ event }) => { console.log(event.path); }';
const OTHER_SOURCE = 'async ({ event, ctx }) => { console.log(ctx.url); }';

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    appUid = `app-${uuidv4()}`;
    otherAppUid = `app-${uuidv4()}`;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    await env.server.clients.db.write('DELETE FROM `event_handlers`', []);
    await env.server.clients.db.write('DELETE FROM `event_subscriptions`', []);
});

describe('publishing a handler', () => {
    it('creates a name that was not there', async () => {
        const { handler, outcome } = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(outcome).toBe('created');
        expect(handler.sourceHash).toBe(hashContent(SOURCE));
        await expect(
            handlers().getByName(appUid, 'ingestUpload'),
        ).resolves.toMatchObject({ name: 'ingestUpload', source: SOURCE });
    });

    it('is a no-op when the same source is published again', async () => {
        const first = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });
        const again = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        expect(again.outcome).toBe('unchanged');
        expect(again.handler.updatedAt).toBe(first.handler.updatedAt);
    });

    it('refuses different source from a publisher that did not name the base', async () => {
        await handlers().publish({ appUid, name: 'ingestUpload', source: SOURCE });

        await expect(
            handlers().publish({
                appUid,
                name: 'ingestUpload',
                source: OTHER_SOURCE,
            }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
        await expect(
            handlers().getByName(appUid, 'ingestUpload'),
        ).resolves.toMatchObject({ source: SOURCE });
    });

    it('takes the update from a publisher whose base is what is published', async () => {
        const first = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        const updated = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: OTHER_SOURCE,
            ifHash: first.handler.sourceHash,
        });

        expect(updated.outcome).toBe('updated');
        expect(updated.handler.sourceHash).toBe(hashContent(OTHER_SOURCE));
    });

    it('refuses the second of two build steps that both branched from the same base', async () => {
        const base = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: OTHER_SOURCE,
            ifHash: base.handler.sourceHash,
        });

        await expect(
            handlers().publish({
                appUid,
                name: 'ingestUpload',
                source: 'async () => { /* a third build */ }',
                ifHash: base.handler.sourceHash,
            }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
    });

    it('takes the name outright for a publisher that asked to replace', async () => {
        await handlers().publish({ appUid, name: 'ingestUpload', source: SOURCE });

        const replaced = await handlers().publish({
            appUid,
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
                appUid,
                name: 'ingestUpload',
                source: SOURCE,
                ifHash: hashContent(OTHER_SOURCE),
            }),
        ).rejects.toSatisfy(codeOf('events_handler_conflict'));
    });

    it('lets exactly one of two racing different-source updates win', async () => {
        const base = await handlers().publish({
            appUid,
            name: 'ingestUpload',
            source: SOURCE,
        });

        const results = await Promise.allSettled([
            handlers().publish({
                appUid,
                name: 'ingestUpload',
                source: OTHER_SOURCE,
                ifHash: base.handler.sourceHash,
            }),
            handlers().publish({
                appUid,
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
        const stored = await handlers().getByName(appUid, 'ingestUpload');
        expect([OTHER_SOURCE, 'async () => { /* the other racer */ }']).toContain(
            stored!.source,
        );
    });

    it('never lets a create-vs-create race leak a raw database error', async () => {
        const results = await Promise.allSettled([
            handlers().publish({
                appUid,
                name: 'brandNew',
                source: SOURCE,
            }),
            handlers().publish({
                appUid,
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

        const stored = await handlers().getByName(appUid, 'brandNew');
        expect([SOURCE, OTHER_SOURCE]).toContain(stored!.source);
    });

    it('scopes the name to one app', async () => {
        await handlers().publish({ appUid, name: 'ingestUpload', source: SOURCE });
        const other = await handlers().publish({
            appUid: otherAppUid,
            name: 'ingestUpload',
            source: OTHER_SOURCE,
        });

        expect(other.outcome).toBe('created');
        await expect(
            handlers().getByName(appUid, 'ingestUpload'),
        ).resolves.toMatchObject({ source: SOURCE });
    });

    it('refuses a name that is not an addressable identifier', async () => {
        for (const name of ['', ' leading', 'has space', '-dash', 'x'.repeat(129)]) {
            await expect(
                handlers().publish({ appUid, name, source: SOURCE }),
            ).rejects.toSatisfy(codeOf('events_handler_name_invalid'));
        }
    });

    it('refuses empty source and source past the cap', async () => {
        await expect(
            handlers().publish({ appUid, name: 'empty', source: '   ' }),
        ).rejects.toSatisfy(codeOf('events_handler_source_invalid'));

        await expect(
            handlers().publish({
                appUid,
                name: 'huge',
                source: 'x'.repeat(EVENTS_HANDLER_SOURCE_MAX_BYTES + 1),
            }),
        ).rejects.toSatisfy(codeOf('events_handler_too_large'));
    });
});

describe('listing handlers', () => {
    it('reports names, hashes and dependents, never source', async () => {
        await handlers().publish({ appUid, name: 'ingestUpload', source: SOURCE });
        await handlers().publish({
            appUid,
            name: 'indexDocument',
            source: OTHER_SOURCE,
        });

        const listed = await handlers().listForApp(appUid);

        expect(listed.map((row) => row.name)).toEqual([
            'indexDocument',
            'ingestUpload',
        ]);
        expect(listed[1]).toMatchObject({
            name: 'ingestUpload',
            hash: hashContent(SOURCE),
            subscriptions: 0,
        });
        expect(
            listed.every((row) => !('source' in row)),
        ).toBe(true);
    });

    it('counts the subscriptions each name is carrying', async () => {
        await handlers().publish({ appUid, name: 'ingestUpload', source: SOURCE });
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

        const [listed] = await handlers().listForApp(appUid);
        expect(listed.subscriptions).toBe(2);
    });
});

describe('removing a handler', () => {
    it('drops the row and reports what it was', async () => {
        await handlers().publish({ appUid, name: 'ingestUpload', source: SOURCE });

        await expect(
            handlers().remove(appUid, 'ingestUpload'),
        ).resolves.toMatchObject({ name: 'ingestUpload' });
        await expect(
            handlers().getByName(appUid, 'ingestUpload'),
        ).resolves.toBeNull();
    });

    it('answers null for a name the app never published', async () => {
        await expect(handlers().remove(appUid, 'nothing')).resolves.toBeNull();
    });
});

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
 * A user-scope handler through the real local worker runtime: created inline by
 * an app session, deployed eagerly as its holder, fired by an event, and run
 * with the holder's identity. Also the rehydrate route's scope resolution.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    appHandlerScope,
    hashContent,
} from '../../stores/events/EventHandlerStore.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { userHandlerScript } from './workerRuntime.js';

const BOOT_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 60_000;
const INTERNAL_SECRET = 'events-internal-secret';

const SOURCE = `async ({ event, ctx, user, fetch, ack }) => {
    await fetch(ctx.sink, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            label: ctx.label,
            path: event.path,
            token: user.authToken,
        }),
    });
    await ack();
}`;

interface SinkPost {
    label?: string;
    path?: string;
    token?: string;
}

let env: PuterTestEnv;
let holders: Array<{ id: number; uuid: string; anchor: string; token: string }>;
let appUid: string;
let sink: http.Server;
let sinkUrl: string;
let sinkPosts: SinkPost[];

const localWorkers = () => env.server.services.localworkerservice;

const scriptFor = (source: string): string =>
    userHandlerScript(
        { name: `@${hashContent(source)}`, sourceHash: hashContent(source) },
        '',
    );

const isResident = async (script: string): Promise<boolean> =>
    (await localWorkers().dispatchEventsWorker(
        new Request(`http://${script}.workers.puter.localhost/`, {
            method: 'GET',
        }),
    )) !== null;

const api = async (
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: object,
): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(new URL(path, env.apiOrigin), {
        method,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
    };
};

const rehydrate = async (
    body: object,
): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(
        new URL('/events/worker/rehydrate', env.apiOrigin),
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-puter-internal-auth': INTERNAL_SECRET,
            },
            body: JSON.stringify(body),
        },
    );
    return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
    };
};

const createInline = async (
    holder: (typeof holders)[number],
    label: string,
    source = SOURCE,
): Promise<string> => {
    const response = await api('POST', '/events/subscribe', holder.token, {
        subject: `fs:${holder.anchor}`,
        delivery: 'single',
        handlerSource: source,
        context: { sink: sinkUrl, label },
    });
    expect(response.status).toBe(200);
    return String(response.body.subId);
};

const delivered = (count = 1): Promise<void> =>
    vi.waitFor(() => expect(sinkPosts.length).toBeGreaterThanOrEqual(count), {
        timeout: 30_000,
        interval: 50,
    });

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: {
            enabled: true,
            workerRuntime: true,
            userHandlers: true,
            internalSecret: INTERNAL_SECRET,
        },
        workers: { localServer: true },
        unlimitedMetering: true,
    } as IConfig);

    const owner = (await env.server.stores.user.getByUsername(
        env.users.user.username,
    ))!;
    appUid = `app-${uuidv4()}`;
    await env.server.clients.db.write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [appUid, appUid, appUid, `https://${appUid}.example/`, owner.id],
    );

    holders = [];
    for (const account of [env.users.user, env.users.other]) {
        const user = (await env.server.stores.user.getByUsername(
            account.username,
        ))!;
        const anchor = `/${account.username}/uh-e2e`;
        await env.server.services.fs.mkdir(user.id, {
            path: anchor,
            createMissingParents: true,
        });
        const entry = await env.server.stores.fsEntry.getEntryByPath(anchor);
        const { actor } = await env.server.services.auth.authenticate(
            account.token,
        );
        for (const permission of [
            `fs:${entry!.uid}:list`,
            EVENTS_BACKGROUND_PERMISSION,
        ])
            await env.server.services.permission.grantUserAppPermission(
                actor!,
                appUid,
                permission,
            );
        holders.push({
            id: user.id,
            uuid: user.uuid,
            anchor,
            token: await env.server.services.auth.getUserAppToken(
                actor!,
                appUid,
            ),
        });
    }

    sinkPosts = [];
    sink = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            sinkPosts.push(
                JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
            );
            res.writeHead(200).end();
        });
    });
    await new Promise<void>((resolve) =>
        sink.listen(0, '127.0.0.1', () => resolve()),
    );
    sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}`;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await new Promise<void>((resolve) => {
        if (!sink) return resolve();
        sink.closeAllConnections();
        sink.close(() => resolve());
    });
    await env?.shutdown();
});

beforeEach(() => {
    sinkPosts = [];
});

describe('an inline handler in a user scope, end to end', () => {
    it(
        'is deployed eagerly, fires on an event and runs as its holder',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const [holder] = holders;
            const source = `${SOURCE}\n// run-as-holder`;
            const script = scriptFor(source);
            expect(await isResident(script)).toBe(false);

            await createInline(holder, 'inline', source);

            // The deploy started with the publish, before any event.
            await vi.waitFor(async () =>
                expect(await isResident(script)).toBe(true),
            );

            await env.server.services.fs.touch(holder.id, {
                path: `${holder.anchor}/note.txt`,
            });
            await delivered();

            expect(sinkPosts[0]).toMatchObject({
                label: 'inline',
                path: `${holder.anchor}/note.txt`,
            });
            const { actor } = await env.server.services.auth.authenticate(
                sinkPosts[0].token!,
            );
            expect(actor!.user?.id).toBe(holder.id);
            expect(actor!.effectiveApp?.uid).toBe(appUid);
        },
    );

    it(
        'shares one deployed script between holders of the same code, each run as its own holder',
        { timeout: TEST_TIMEOUT_MS },
        async () => {
            const source = `${SOURCE}\n// shared-code`;
            const script = scriptFor(source);
            const create = vi.spyOn(env.server.drivers.workers, 'create');

            await createInline(holders[0], 'first', source);
            await vi.waitFor(async () =>
                expect(await isResident(script)).toBe(true),
            );
            await createInline(holders[1], 'second', source);
            // Let the second holder's eager deploy settle before counting.
            await new Promise((resolve) => setTimeout(resolve, 500));

            // The marker made the second holder's eager deploy a no-op.
            expect(
                create.mock.calls.filter(
                    ([args]) =>
                        (args as { workerName: string }).workerName === script,
                ),
            ).toHaveLength(1);

            for (const [i, holder] of holders.entries())
                await env.server.services.fs.touch(holder.id, {
                    path: `${holder.anchor}/shared-${i}.txt`,
                });
            await delivered(2);
            const runAs = new Set<number>();
            for (const post of sinkPosts)
                runAs.add(
                    (await env.server.services.auth.authenticate(post.token!))
                        .actor!.user!.id,
                );
            expect(runAs).toEqual(new Set(holders.map((h) => h.id)));
            create.mockRestore();
        },
    );
});

describe('the rehydrate route', () => {
    const source = `${SOURCE}\n// rehydrate`;
    const script = scriptFor(source);

    beforeAll(async () => {
        // Rows only: the handler is published, nothing is deployed here.
        const eventHandler = env.server.stores.eventHandler;
        await eventHandler.publish({
            scope: { appUid, holder: holders[0].id },
            name: `@${hashContent(source)}`,
            source,
            broadcast: false,
        });
        await eventHandler.publish({
            scope: { appUid, holder: holders[1].id },
            name: 'other',
            source: SOURCE,
            broadcast: false,
        });
    });

    it('resolves the holder`s user scope when the body names one', async () => {
        const response = await rehydrate({
            script,
            appUid,
            holder: holders[0].uuid,
        });
        expect(response).toMatchObject({
            status: 200,
            body: { deployed: true },
        });
        expect(await isResident(script)).toBe(true);
    });

    it('reads an absent or empty holder as the app scope, which has no such handler', async () => {
        for (const body of [
            { script, appUid },
            { script, appUid, holder: '' },
        ])
            expect(await rehydrate(body)).toMatchObject({
                status: 404,
                body: { deployed: false, reason: 'no-handlers' },
            });
        expect(
            await env.server.stores.eventHandler.listForApp(
                appHandlerScope(appUid),
            ),
        ).toEqual([]);
    });

    it('answers stale for a holder whose scope does not hold that handler', async () => {
        expect(
            await rehydrate({ script, appUid, holder: holders[1].uuid }),
        ).toMatchObject({
            status: 404,
            body: { deployed: false, reason: 'stale' },
        });
    });

    it('refuses a holder that does not exist, and a malformed one', async () => {
        expect(
            await rehydrate({ script, appUid, holder: uuidv4() }),
        ).toMatchObject({
            status: 404,
            body: { deployed: false, reason: 'no-holder' },
        });
        expect(
            (await rehydrate({ script, appUid, holder: 'a b' })).status,
        ).toBe(400);
        expect((await rehydrate({ script, appUid, holder: 7 })).status).toBe(
            400,
        );
    });
});

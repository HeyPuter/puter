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
 * `notify({ sendAt })` without and with `services.schedules`, and the deferred
 * mailbox write an extension runs inside its own transaction, fenced on a guard
 * in a table of its own (a test table here).
 */

import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { BatchEntry } from '../../clients/database/DatabaseClient.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { isHttpError } from '../../core/http/HttpError.js';
import type {
    DeferredSendPlan,
    ScheduleServiceContract,
} from '../../core/schedules.js';
import type { PuterServer } from '../../server.js';
import { EVENTS_BACKGROUND_PERMISSION } from '../../services/events/authorization.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import type {
    DeferredWriteTx,
    NotificationDriver,
} from './NotificationDriver.js';

vi.setConfig({ testTimeout: 120_000 });

const BOOT_TIMEOUT_MS = 480_000;
const TEST_TABLE = 'deferred_send_test';

let server: PuterServer;
let holder: Actor;
let app: { id: number; uid: string };
let saved: unknown;
let nextId = 1;

const db = () => server.clients.db;
const driver = () =>
    server.drivers.notifications as unknown as NotificationDriver;
const slot = () => server.services as unknown as { schedules?: unknown };
/** Put `schedules` in the slot, or leave the slot empty. */
const setSchedules = (schedules: unknown): void => {
    if (schedules === undefined) delete slot().schedules;
    else slot().schedules = schedules;
};
const asApp = (): Actor => makeActor({ user: holder.user, app });

const notify = (fields: Record<string, unknown>): Promise<unknown> =>
    runWithContext({ actor: asApp() }, () =>
        driver().create({
            object: { value: { type: 'app.message', title: 'Hi', ...fields } },
        }),
    );

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
    try {
        await run;
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

const mailbox = () =>
    db().read(
        'SELECT * FROM `notification` WHERE `user_id` = ? AND `app_uid` = ? ' +
            'ORDER BY `id`',
        [holder.user!.id, app.uid],
    );

/** A row's value: JSON text on sqlite, parsed on the other engines. */
const valueOf = (row: Record<string, unknown>) =>
    typeof row.value === 'string' ? JSON.parse(row.value) : row.value;

/** A send claimed under `token`, as an extension's own row would be. */
const claimed = async (token: string): Promise<number> => {
    const id = nextId++;
    await db().write(
        `INSERT INTO \`${TEST_TABLE}\` (\`id\`, \`token\`, \`state\`) VALUES (?, ?, 'sending')`,
        [id, token],
    );
    return id;
};

/** The transaction an extension wraps the write in: its row, then the mailbox. */
const txFor = (id: number, token: string): DeferredWriteTx => ({
    guard: {
        table: TEST_TABLE,
        where: "`id` = ? AND `token` = ? AND `state` = 'delivered'",
        values: [id, token],
    },
    async commit(entries: readonly BatchEntry[]) {
        await db().batchWrite([
            {
                statement:
                    `UPDATE \`${TEST_TABLE}\` SET \`state\` = 'delivered' ` +
                    "WHERE `id` = ? AND `token` = ? AND `state` = 'sending'",
                values: [id, token],
            },
            ...entries,
        ]);
        const [row] = await db().pread(
            `SELECT \`state\`, \`token\` FROM \`${TEST_TABLE}\` WHERE \`id\` = ?`,
            [id],
        );
        return row?.state === 'delivered' && row.token === token;
    },
});

const write = (
    sendKey: string,
    tx: DeferredWriteTx,
    over: {
        payload?: string | null;
        appUid?: string;
        signal?: AbortSignal;
    } = {},
) =>
    driver().deferredAppMessages.write(
        {
            holderUserId: holder.user!.id,
            appUid: over.appUid ?? app.uid,
            payload:
                over.payload === undefined
                    ? JSON.stringify({ message: { title: 'Later' } })
                    : over.payload,
            sendKey,
            signal: over.signal ?? new AbortController().signal,
        },
        tx,
    );

const fakeSchedules = (plan: Partial<DeferredSendPlan>) =>
    ({
        onSubscriptionsChanged: vi.fn(async () => {}),
        createFor: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        receivePeerChanges: vi.fn(),
        prepareSendAt: vi.fn(async (): Promise<DeferredSendPlan> => ({
            sendAt: 0,
            immediate: false,
            holderUserId: holder.user!.id,
            appUid: app.uid,
            handlerDepth: 0,
            quota: {
                recurringPerUser: 1,
                recurringPerApp: 1,
                oneShotsPerUser: 1,
                oneShotsPerApp: 1,
                budgetPerUser: 1,
                budgetPerApp: 1,
            },
            ...plan,
        })),
        createDeferredAppMessage: vi.fn(async (p: DeferredSendPlan) => ({
            scheduleId: 'sched-1',
            sendAt: p.sendAt,
        })),
    }) satisfies ScheduleServiceContract;

beforeAll(async () => {
    server = await setupTestServer({
        events: { enabled: true },
    } as IConfig);
    const username = `sendat-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    const row = (await server.stores.user.getById(user.id))!;
    holder = makeActor({
        user: {
            id: row.id,
            uuid: row.uuid,
            username: row.username,
            email: row.email ?? null,
            email_confirmed: true,
        } as Actor['user'],
    });
    const name = `sendat-app-${Math.random().toString(36).slice(2, 10)}`;
    app = (await server.stores.app.create(
        { name, title: name, index_url: `https://${name}.test/` },
        { ownerUserId: row.id },
    )) as { id: number; uid: string };
    await server.services.permission.grantUserAppPermission(
        holder,
        app.uid,
        EVENTS_BACKGROUND_PERMISSION,
    );
    await db().write(
        `CREATE TABLE \`${TEST_TABLE}\` (\`id\` INTEGER PRIMARY KEY, ` +
            '`token` VARCHAR(64) NOT NULL, `state` VARCHAR(16) NOT NULL)',
        [],
    );
    saved = slot().schedules;
}, BOOT_TIMEOUT_MS);

beforeEach(async () => {
    await db().write('DELETE FROM `notification` WHERE `app_uid` = ?', [
        app.uid,
    ]);
});

afterEach(() => {
    setSchedules(saved);
    vi.restoreAllMocks();
});

afterAll(async () => {
    await server?.shutdown();
});

describe('notify({ sendAt }) without services.schedules', () => {
    it('is refused events_disabled, even when due now, storing nothing', async () => {
        setSchedules(undefined);
        expect(await codeOf(notify({ sendAt: Date.now() }))).toBe(
            'events_disabled',
        );
        expect(await codeOf(notify({ sendAt: Date.now() + 3_600_000 }))).toBe(
            'events_disabled',
        );
        expect(await mailbox()).toEqual([]);
    });

    it('sends as before without sendAt', async () => {
        setSchedules(undefined);
        const sent = (await notify({ text: 'now' })) as { uid: string };
        expect(sent.uid).toBeTruthy();
        expect(await mailbox()).toHaveLength(1);
    });
});

describe('notify({ sendAt }) with services.schedules', () => {
    it('hands a later send to createDeferredAppMessage and answers its id', async () => {
        const at = Date.now() + 3_600_000;
        const schedules = fakeSchedules({ sendAt: at });
        setSchedules(schedules);

        await expect(
            notify({ sendAt: at, text: 'later', priority: 'high' }),
        ).resolves.toEqual({
            scheduled: { scheduleId: 'sched-1', sendAt: at },
        });
        expect(schedules.prepareSendAt).toHaveBeenCalledWith(
            expect.objectContaining({ user: holder.user }),
            at,
        );
        expect(schedules.createDeferredAppMessage).toHaveBeenCalledWith(
            expect.objectContaining({ sendAt: at }),
            {
                message: expect.objectContaining({
                    title: 'Hi',
                    text: 'later',
                    priority: 'high',
                }),
            },
        );
        expect(await mailbox()).toEqual([]);
    });

    it('sends at once when the plan says it is due', async () => {
        const schedules = fakeSchedules({ immediate: true });
        setSchedules(schedules);

        const sent = (await notify({ sendAt: Date.now() })) as {
            uid: string;
        };
        expect(sent.uid).toBeTruthy();
        expect(schedules.createDeferredAppMessage).not.toHaveBeenCalled();
        expect(await mailbox()).toHaveLength(1);
    });

    it('passes a refusal from prepareSendAt through', async () => {
        const schedules = fakeSchedules({});
        schedules.prepareSendAt.mockRejectedValueOnce(
            Object.assign(new Error('scoped'), {}),
        );
        setSchedules(schedules);
        await expect(notify({ sendAt: Date.now() })).rejects.toThrow('scoped');
        expect(await mailbox()).toEqual([]);
    });
});

describe('deferredAppMessages.write', () => {
    it('writes one row keyed by the send, in the caller`s transaction', async () => {
        const token = uuidv4();
        const key = uuidv4();
        const id = await claimed(token);

        await expect(
            write(key, txFor(id, token), {
                payload: JSON.stringify({
                    message: { title: 'Later', priority: 'high' },
                }),
            }),
        ).resolves.toBe('delivered');
        const rows = await mailbox();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ uid: key, send_key: key });
        expect(valueOf(rows[0])).toMatchObject({
            title: 'Later',
            priority: 'high',
        });
    });

    it('writes nothing when the guard no longer holds: another claim took it', async () => {
        const id = await claimed(uuidv4());
        const key = uuidv4();

        await expect(write(key, txFor(id, uuidv4()))).resolves.toBe('lost');
        expect(await mailbox()).toEqual([]);
    });

    it('replaces the open row of its group, which takes the key', async () => {
        const open = (await notify({ group: 'g', text: 'first' })) as {
            uid: string;
        };
        const token = uuidv4();
        const key = uuidv4();
        const id = await claimed(token);

        await expect(
            write(key, txFor(id, token), {
                payload: JSON.stringify({
                    message: { title: 'Later', group: 'g' },
                }),
            }),
        ).resolves.toBe('delivered');
        const rows = await mailbox();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ uid: open.uid, send_key: key });
        expect(valueOf(rows[0])).toMatchObject({ title: 'Later' });
    });

    it('drops a payload it can`t read, and a sender whose app is gone', async () => {
        const token = uuidv4();
        const id = await claimed(token);
        await expect(
            write(uuidv4(), txFor(id, token), { payload: '{"nope":1}' }),
        ).resolves.toBe('dropped');
        await expect(
            write(uuidv4(), txFor(id, token), { appUid: `app-${uuidv4()}` }),
        ).resolves.toBe('dropped');
        expect(await mailbox()).toEqual([]);
    });

    it('writes nothing once the caller`s claim is lost', async () => {
        const token = uuidv4();
        const id = await claimed(token);
        const lost = new AbortController();
        lost.abort();

        await expect(
            write(uuidv4(), txFor(id, token), { signal: lost.signal }),
        ).rejects.toThrow();
        expect(await mailbox()).toEqual([]);
    });
});

/**
 * A second claim taking a send over while the first one's transaction is open.
 * Needs two writers at once with row locks; sqlite serialises writers, so this
 * runs on postgres only.
 */
describe.runIf(process.env.PUTER_TEST_DB_ENGINE === 'postgres')(
    'a deferred write racing another writer',
    () => {
        /**
         * Hold the first statement matching `match` on its connection, before
         * or after it runs, until released.
         */
        const holdStatement = (match: RegExp, when: 'before' | 'after') => {
            const client = db() as unknown as {
                query: (
                    target: unknown,
                    sql: string,
                    params?: unknown[],
                ) => Promise<unknown>;
            };
            const original = client.query.bind(client);
            let reached!: () => void;
            let release!: () => void;
            const atBarrier = new Promise<void>((r) => (reached = r));
            const released = new Promise<void>((r) => (release = r));
            let held = false;
            vi.spyOn(client as never, 'query' as never).mockImplementation(
                (async (target: unknown, sql: string, params?: unknown[]) => {
                    if (held || !match.test(sql))
                        return original(target, sql, params);
                    held = true;
                    if (when === 'before') {
                        reached();
                        await released;
                        return original(target, sql, params);
                    }
                    const result = await original(target, sql, params);
                    reached();
                    await released;
                    return result;
                }) as never,
            );
            return { atBarrier, release };
        };

        const DELIVERED = /SET `state` = 'delivered'/;
        const REPLACE = /`replaced_at` = \?, `send_key` = \? WHERE/;

        /** Whether `promise` is still pending after `ms`. */
        const stillPending = async (promise: Promise<unknown>, ms: number) => {
            let settled = false;
            const watched = (async () => {
                try {
                    await promise;
                } finally {
                    settled = true;
                }
            })();
            await new Promise((r) => setTimeout(r, ms));
            void watched;
            return !settled;
        };

        it('a transaction that opened before a takeover writes nothing', async () => {
            const stale = uuidv4();
            const id = await claimed(stale);
            const key = uuidv4();
            const gate = holdStatement(DELIVERED, 'before');
            const first = write(key, txFor(id, stale));
            await gate.atBarrier;

            await db().write(
                `UPDATE \`${TEST_TABLE}\` SET \`token\` = ? WHERE \`id\` = ?`,
                [uuidv4(), id],
            );
            gate.release();
            await expect(first).resolves.toBe('lost');
            expect(
                await server.stores.notification.getBySendKey(key),
            ).toBeNull();
            expect(await mailbox()).toEqual([]);
        });

        it('an immediate replacement waiting on the open transaction lands after it, without the key', async () => {
            const open = (await notify({ group: 'g', text: 'first' })) as {
                uid: string;
            };
            const token = uuidv4();
            const id = await claimed(token);
            const key = uuidv4();
            const gate = holdStatement(REPLACE, 'after');
            const deferred = write(key, txFor(id, token), {
                payload: JSON.stringify({
                    message: { title: 'Later', group: 'g', text: 'later' },
                }),
            });
            await gate.atBarrier;

            const immediate = notify({ group: 'g', text: 'newer' });
            // Past the group lock's wait, then blocked on the row.
            expect(await stillPending(immediate, 2_500)).toBe(true);
            gate.release();
            await expect(deferred).resolves.toBe('delivered');
            await immediate;

            const rows = await mailbox();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ uid: open.uid, send_key: null });
            expect(valueOf(rows[0]).text).toBe('newer');
        });
    },
);

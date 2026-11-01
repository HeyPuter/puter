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
 * Schedules against the subscription lifecycle: validating a create, the
 * subscription verbs that refuse a schedule's row, the hook every lifecycle
 * path runs, and holder-wide settles that have to reach past the durable cap.
 */

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
import { v4 as uuidv4 } from 'uuid';
import {
    EVENTS_SCHEDULES_PER_APP,
    limitFor,
} from '../../controllers/events/limits.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import { hashContent } from '../../stores/events/EventHandlerStore.js';
import type { ScheduleInput } from '../../stores/events/ScheduleStore.js';
import { scheduleToken } from '../../stores/events/types.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { actorPlanId } from '../metering/enforcement.js';
import { EVENTS_BACKGROUND_PERMISSION } from './authorization.js';
import { ScheduleService } from './ScheduleService.js';

const BOOT_TIMEOUT_MS = 120_000;
const HOUR = 60 * 60 * 1000;
const SOURCE = 'async ({ event }) => { return event.id; }';

let env: PuterTestEnv;
let userId: number;
let otherUserId: number;
let userRow: Record<string, unknown>;
let appUid: string;
let appActor: Actor;

const events = () => env.server.services.events;
const schedules = () => env.server.services.schedule;
const store = () => env.server.stores.schedule;
const durable = () => env.server.stores.durableSubscription;
const db = () => env.server.clients.db;

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
    try {
        await run;
    } catch (err) {
        if (isHttpError(err)) return err.legacyCode;
        throw err;
    }
    return undefined;
};

const makeApp = async (): Promise<{ uid: string; id: number }> => {
    const uid = `app-${uuidv4()}`;
    await db().write(
        'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
        [uid, uid, uid, `https://${uid}.example/`, userId],
    );
    const [row] = await db().read('SELECT `id` FROM `apps` WHERE `uid` = ?', [
        uid,
    ]);
    return { uid, id: Number(row.id) };
};

const scheduleInput = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
    namespace: schedules().namespace,
    region: 'region-a',
    kind: 'recurring',
    holderUserId: userId,
    appUid,
    startAt: Date.parse('2026-11-02T00:00:00Z'),
    everyMs: HOUR,
    cron: null,
    tz: 'UTC',
    endsAt: null,
    ratePerHour: 1000,
    minGapMs: HOUR,
    handlerDepth: 0,
    subscription: {
        handlerName: 'tick',
        context: null,
        permission: EVENTS_BACKGROUND_PERMISSION,
    },
    quota: {
        recurringPerUser: 10_000,
        recurringPerApp: 10_000,
        oneShotsPerUser: 10_000,
        oneShotsPerApp: 10_000,
        budgetPerUser: 1e12,
        budgetPerApp: 1e12,
    },
    ...over,
});

/** A schedule, and the subscription row it owns. */
const createSchedule = async () => {
    const row = await store().create(scheduleInput());
    const sub = await durable().getBySubId(row.subId!);
    return { row, sub: sub! };
};

const reread = async (uid: string) =>
    (await store().get(schedules().namespace, uid))!;

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true, schedules: { enabled: true } },
        // Seeded accounts carry no email, which the plan machinery reads as a
        // temporary account, and a temporary account holds no schedules.
        unlimitedMetering: true,
    } as IConfig);
    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    userRow = user as unknown as Record<string, unknown>;
    const other = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    otherUserId = other!.id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

beforeEach(async () => {
    const app = await makeApp();
    appUid = app.uid;
    appActor = makeActor({
        user: userRow as never,
        app: { uid: app.uid, id: app.id },
    });
    await db().write('DELETE FROM `event_schedules`', []);
    await db().write('DELETE FROM `event_subscriptions`', []);
});

describe('preparing a create', () => {
    const consent = (uid: string) =>
        env.server.services.permission.grantUserAppPermission(
            makeActor({ user: userRow as never }),
            uid,
            EVENTS_BACKGROUND_PERMISSION,
        );

    beforeEach(async () => {
        await env.server.stores.eventHandler.publish({
            appUid,
            name: 'tick',
            source: SOURCE,
        });
        await consent(appUid);
    });

    it('validates, and resolves who it is for and the caps it is held to', async () => {
        const plan = await schedules().prepareCreate(appActor, {
            every: '1h',
            handlerName: 'tick',
            handlerHash: hashContent(SOURCE),
            context: { team: 'design' },
        });
        const planId = await actorPlanId(
            env.server.services.metering,
            appActor,
        );
        expect(plan).toMatchObject({
            kind: 'recurring',
            everyMs: HOUR,
            namespace: 'puter.localhost',
            holderUserId: userId,
            appUid,
            handlerName: 'tick',
            handlerDepth: 0,
            context: '{"team":"design"}',
        });
        expect(plan.quota.recurringPerApp).toBe(
            limitFor(EVENTS_SCHEDULES_PER_APP, planId),
        );
    });

    it('is refused while schedules are off', async () => {
        const off = new ScheduleService(
            { ...env.server.config, events: { enabled: true } } as IConfig,
            env.server.clients as never,
            env.server.stores as never,
            env.server.services as never,
        );
        await expect(
            codeOf(
                off.prepareCreate(appActor, {
                    every: '1h',
                    handlerName: 'tick',
                }),
            ),
        ).resolves.toBe('events_disabled');
    });

    it('needs an app', async () => {
        const account = makeActor({ user: userRow as never });
        await expect(
            codeOf(
                schedules().prepareCreate(account, {
                    every: '1h',
                    handlerName: 'tick',
                }),
            ),
        ).resolves.toBe('events_schedule_app_required');
    });

    it('refuses a scoped token, even one an app issued', async () => {
        const scoped = makeActor({
            user: userRow as never,
            accessToken: { uid: `tok-${uuidv4()}`, issuer: appActor } as never,
        });
        expect(scoped.effectiveApp?.uid).toBe(appUid);
        await expect(
            codeOf(
                schedules().prepareCreate(scoped, {
                    every: '1h',
                    handlerName: 'tick',
                }),
            ),
        ).resolves.toBe('events_durable_requires_account');
    });

    it('needs the holder`s background consent for the app', async () => {
        const app = await makeApp();
        await env.server.stores.eventHandler.publish({
            appUid: app.uid,
            name: 'tick',
            source: SOURCE,
        });
        const actor = makeActor({
            user: userRow as never,
            app: { uid: app.uid, id: app.id },
        });
        await expect(
            codeOf(
                schedules().prepareCreate(actor, {
                    every: '1h',
                    handlerName: 'tick',
                }),
            ),
        ).resolves.toBe('events_background_consent_required');
        await consent(app.uid);
        await expect(
            schedules().prepareCreate(actor, {
                every: '1h',
                handlerName: 'tick',
            }),
        ).resolves.toMatchObject({ appUid: app.uid });
    });

    it('needs the handler to be published, with the source it names', async () => {
        await expect(
            codeOf(
                schedules().prepareCreate(appActor, {
                    every: '1h',
                    handlerName: 'missing',
                }),
            ),
        ).resolves.toBe('events_handler_not_found');
        await expect(
            codeOf(
                schedules().prepareCreate(appActor, {
                    every: '1h',
                    handlerName: 'tick',
                    handlerHash: hashContent('something else'),
                }),
            ),
        ).resolves.toBe('events_handler_hash_mismatch');
    });

    it('passes the plan minimum to validation', async () => {
        await expect(
            codeOf(
                schedules().prepareCreate(appActor, {
                    every: '30s',
                    handlerName: 'tick',
                }),
            ),
        ).resolves.toBe('events_schedule_too_frequent');
    });
});

describe('the subscription verbs', () => {
    it('refuse to update a schedule`s row', async () => {
        const { sub } = await createSchedule();
        const refused = await codeOf(
            events().updateDurable(appActor, {
                subId: sub.subId,
                context: { changed: true },
            }),
        );
        expect(refused).toBe('events_schedule_immutable');
        await expect(durable().getBySubId(sub.subId)).resolves.toMatchObject({
            context: null,
        });
    });

    it('refuse to unsubscribe a schedule`s row', async () => {
        const { sub } = await createSchedule();
        await expect(
            codeOf(events().unsubscribeDurable(appActor, { subId: sub.subId })),
        ).resolves.toBe('events_schedule_not_found');
        await expect(durable().getBySubId(sub.subId)).resolves.not.toBeNull();
    });

    it('answer someone else`s schedule row as absent', async () => {
        const { sub } = await createSchedule();
        const stranger = makeActor({
            user: { id: otherUserId } as never,
            app: { uid: appUid, id: 1 },
        });
        await expect(
            codeOf(events().unsubscribeDurable(stranger, { subId: sub.subId })),
        ).resolves.toBe('subscription_does_not_exist');
    });

    it('refuse to subscribe to a schedule subject', async () => {
        await expect(
            codeOf(
                events().subscribeDurable(appActor, {
                    subject: scheduleToken(uuidv4()),
                }),
            ),
        ).resolves.toBe('invalid_subject');
    });

    it('leave schedules out of the durable listing', async () => {
        await createSchedule();
        await expect(events().listDurable(appActor, {})).resolves.toEqual({
            items: [],
        });
    });
});

describe('the lifecycle hook', () => {
    const pds = () => env.server.stores.pendingDelivery;
    let spies: Array<ReturnType<typeof vi.spyOn>>;

    beforeEach(() => {
        spies = (
            ['purge', 'hold', 'releaseHold', 'claim', 'enqueue'] as const
        ).map((method) => vi.spyOn(pds(), method));
    });

    afterEach(() => {
        for (const spy of spies) spy.mockRestore();
    });

    /** No backlog call ever names a schedule's row. */
    const expectNoBacklogCalls = (subId: string) => {
        for (const spy of spies)
            for (const call of spy.mock.calls) expect(call[0]).not.toBe(subId);
    };

    it('bumps the version on suspend and resume, and touches no backlog', async () => {
        const { row, sub } = await createSchedule();

        await expect(
            events().suspendSubscriptions([sub], 'failures'),
        ).resolves.toBe(1);
        expect(await reread(row.uid)).toMatchObject({
            version: 3,
            state: 'active',
            deletedAt: null,
        });

        const suspended = (await durable().getBySubId(sub.subId))!;
        await expect(events().resumeSubscriptions([suspended])).resolves.toBe(
            1,
        );
        expect(await reread(row.uid)).toMatchObject({
            version: 4,
            deletedAt: null,
        });
        expectNoBacklogCalls(sub.subId);
    });

    it('resumes a schedule a top-up releases', async () => {
        const { row, sub } = await createSchedule();
        await events().suspendForNoCredit(sub.subId);
        await expect(events().resumeForCredit(userId)).resolves.toBe(1);
        expect((await reread(row.uid)).version).toBe(4);
        await expect(durable().getBySubId(sub.subId)).resolves.toMatchObject({
            suspendedAt: null,
        });
        expectNoBacklogCalls(sub.subId);
    });

    it('ends a schedule whose app is uninstalled', async () => {
        const { row, sub } = await createSchedule();
        await events().settleRevokedGrant({
            holderUserId: userId,
            appUid,
            permission: null,
        } as never);
        expect(await reread(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'uninstalled',
        });
        await expect(durable().getBySubId(sub.subId)).resolves.toMatchObject({
            suspendedReason: 'permission_revoked',
        });
        expectNoBacklogCalls(sub.subId);
    });

    it('ends a schedule whose background consent is withdrawn', async () => {
        const { row } = await createSchedule();
        await events().settleRevokedGrant({
            holderUserId: userId,
            appUid,
            permission: EVENTS_BACKGROUND_PERMISSION,
        } as never);
        expect(await reread(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'permission_revoked',
        });
    });

    it('leaves a schedule alone when some other grant is withdrawn', async () => {
        const { row } = await createSchedule();
        await events().settleRevokedGrant({
            holderUserId: userId,
            appUid,
            permission: `fs:${uuidv4()}:read`,
        } as never);
        expect(await reread(row.uid)).toMatchObject({
            version: 2,
            deletedAt: null,
        });
    });

    it('ends a schedule reaped after a month suspended', async () => {
        const { row, sub } = await createSchedule();
        await db().write(
            'UPDATE `event_subscriptions` SET `suspended_at` = ?, `suspended_reason` = ? WHERE `sub_id` = ?',
            [1, 'failures', sub.subId],
        );
        await events().sweepSuspended();
        expect(await reread(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'ended',
        });
        await expect(durable().getBySubId(sub.subId)).resolves.toBeNull();
        expectNoBacklogCalls(sub.subId);
    });

    it('ends a schedule whose app is deleted', async () => {
        const { row, sub } = await createSchedule();
        await events().settleDeletedApp(appUid);
        expect(await reread(row.uid)).toMatchObject({
            state: 'done',
            endReason: 'app_deleted',
        });
        await expect(durable().getBySubId(sub.subId)).resolves.toBeNull();
        expectNoBacklogCalls(sub.subId);
    });

    it('retries a failed SQL step once, and never fails the subscription change', async () => {
        const { sub } = await createSchedule();
        const apply = vi
            .spyOn(store(), 'applySubscriptionChange')
            .mockRejectedValue(new Error('primary unavailable'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await expect(
                events().suspendSubscriptions([sub], 'failures'),
            ).resolves.toBe(1);
            expect(apply).toHaveBeenCalledTimes(2);
        } finally {
            apply.mockRestore();
            warn.mockRestore();
        }
        await expect(durable().getBySubId(sub.subId)).resolves.toMatchObject({
            suspendedReason: 'failures',
        });
    });
});

describe('holder-wide settles', () => {
    const REGULAR = 500;
    const SCHEDULED = 600;

    /** Bulk rows straight into the table, holder `userId`, app `appUid`. */
    const seed = async (
        rows: Array<{ token: string; subject: string; schedule: boolean }>,
        suspendedReason: string | null = null,
    ) => {
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < rows.length; i += 100) {
            const batch = rows.slice(i, i + 100);
            const values: unknown[] = [];
            for (const row of batch)
                values.push(
                    `${appUid}#${uuidv4()}`,
                    row.token,
                    userId,
                    userId,
                    appUid,
                    row.subject,
                    row.schedule
                        ? row.token.slice('schedule:'.length)
                        : uuidv4(),
                    row.schedule ? '' : '/somewhere',
                    row.schedule ? 'single' : 'broadcast',
                    row.schedule ? 'tick' : null,
                    '["socket","worker"]',
                    row.schedule ? EVENTS_BACKGROUND_PERMISSION : 'list',
                    suspendedReason ? now : null,
                    suspendedReason,
                    now,
                );
            await db().write(
                'INSERT INTO `event_subscriptions` (`sub_id`, `token`, `owner_user_id`, ' +
                    '`holder_user_id`, `app_uid`, `subject`, `anchor_uid`, `anchor_path`, ' +
                    '`delivery`, `handler_name`, `targets`, `permission`, `suspended_at`, ' +
                    '`suspended_reason`, `created_at`) VALUES ' +
                    batch
                        .map(
                            () =>
                                '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        )
                        .join(', '),
                values,
            );
        }
    };

    const holderRows = (count: number) => [
        ...Array.from({ length: REGULAR }, () => ({
            token: `f#${uuidv4()}`,
            subject: 'fs:/somewhere',
            schedule: false,
        })),
        ...Array.from({ length: count }, () => {
            const token = scheduleToken(uuidv4());
            return { token, subject: token, schedule: true };
        }),
    ];

    const countWhere = async (where: string, params: unknown[] = []) => {
        const [row] = await db().read(
            `SELECT COUNT(*) AS n FROM \`event_subscriptions\` WHERE ${where}`,
            params,
        );
        return Number(row.n);
    };

    it('an uninstall reaches every row, past the durable cap', async () => {
        await seed(holderRows(SCHEDULED));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await expect(
                events().settleRevokedGrant({
                    holderUserId: userId,
                    appUid,
                    permission: null,
                } as never),
            ).resolves.toBe(REGULAR + SCHEDULED);
        } finally {
            warn.mockRestore();
        }
        await expect(
            countWhere('`suspended_reason` = ?', ['permission_revoked']),
        ).resolves.toBe(REGULAR + SCHEDULED);
    });

    it('a top-up resumes every row, past the durable cap', async () => {
        await seed(holderRows(SCHEDULED), 'no_credit');
        await expect(events().resumeForCredit(userId)).resolves.toBe(
            REGULAR + SCHEDULED,
        );
        // The seeded rows' anchors don't exist, so a resumed regular row may be
        // settled again on its re-check; none is left waiting on credit.
        await expect(
            countWhere('`suspended_reason` = ?', ['no_credit']),
        ).resolves.toBe(0);
    });

    it('retiring a share handle finds its row behind a thousand others', async () => {
        await seed(holderRows(SCHEDULED));
        const handle = `kvh-${uuidv4().replace(/-/g, '')}`;
        const subject = `kv:${handle}:notes`;
        await seed([{ token: `k#${handle}`, subject, schedule: false }]);

        const settled = await events().settleRetiredKvHandles({
            handles: [handle],
            userId,
        });
        expect(settled).toBeGreaterThanOrEqual(1);
        await expect(
            countWhere('`subject` = ? AND `suspended_reason` = ?', [
                subject,
                'permission_revoked',
            ]),
        ).resolves.toBe(1);
    });
});

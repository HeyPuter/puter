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
 * What a plan lets an account hold, and how a suspension for an empty balance
 * is lifted.
 *
 * Delivery metering is held against the delivery paths themselves; this is the
 * half that happens on a timer rather than on an event.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP,
    EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import type { DurableSubscriptionInput } from '../../stores/events/DurableSubscriptionStore.js';
import type { DurableSubscription } from '../../stores/events/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../metering/consts.js';
import type { UsageInput } from '../metering/types.js';
import type { IConfig } from '../../types.js';
import { EVENTS_COSTS } from './costs.js';
import { EventsService } from './EventsService.js';
import { fsAnchorToken } from './subjects.js';

let seq = 0;
let userId = 0;
let service: EventsService;
let rows: DurableSubscription[];
let metered: Array<{ userUuid: string | undefined } & UsageInput>;
let created: DurableSubscriptionInput[];
let resumed: string[];
/** The plan the metering service reports for the acting account. */
let plan: string;
/** Accounts that still have budget, by user id. */
let solvent: Set<number>;

const anchorUid = (): string => `docs-${seq}`;
const anchorPath = (): string => `/u${userId}/Documents`;

const durableRow = (
    over: Partial<DurableSubscription> = {},
): DurableSubscription => ({
    durable: true,
    subId: `sub-${rows.length}`,
    holderUserId: userId,
    ownerUserId: userId,
    subject: `fs:${anchorPath()}`,
    token: fsAnchorToken(anchorUid()),
    anchorUid: anchorUid(),
    anchorPath: anchorPath(),
    match: null,
    op: null,
    appUid: null,
    permission: 'list',
    delivery: 'broadcast',
    targets: ['socket'],
    handlerName: null,
    context: null,
    expiresAt: null,
    suspendedAt: null,
    suspendedReason: null,
    createdAt: Math.floor(Date.now() / 1000),
    ...over,
});

const actorFor = (over: Partial<Actor> = {}): Actor =>
    ({
        user: { id: userId, uuid: `user-${userId}`, username: `u${userId}` },
        effectiveApp: null,
        ...over,
    }) as unknown as Actor;

const appActor = (appUid: string): Actor =>
    actorFor({ app: { uid: appUid, id: 1 }, effectiveApp: { uid: appUid, id: 1 } });

const anchorEntry = (): FSEntry =>
    ({
        uid: anchorUid(),
        uuid: anchorUid(),
        path: anchorPath(),
        userId,
        isDir: true,
    }) as FSEntry;

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

beforeEach(() => {
    seq++;
    userId = 5000 + seq;
    rows = [];
    metered = [];
    created = [];
    resumed = [];
    plan = 'paid_plan';
    solvent = new Set([userId]);

    service = new EventsService(
        { events: { enabled: true } } as IConfig,
        {
            redis: {},
            event: { on: vi.fn(), emit: vi.fn() },
            alarm: { create: vi.fn() },
        } as never,
        {
            durableSubscription: {
                create: async (input: DurableSubscriptionInput) => {
                    created.push(input);
                    const row = durableRow({
                        appUid: input.appUid,
                        delivery: input.delivery,
                        targets: input.targets,
                    });
                    rows.push(row);
                    return {
                        row,
                        bump: { userId: input.ownerUserId, generation: 1 },
                    };
                },
                listSuspendedPage: async (reason: string, afterId: number) =>
                    afterId === 0
                        ? {
                              rows: rows.filter(
                                  (row) => row.suspendedReason === reason,
                              ),
                              nextId: null,
                          }
                        : { rows: [], nextId: null },
                listSuspendedForHolder: async (
                    holderUserId: number,
                    reason: string,
                ) =>
                    rows.filter(
                        (row) =>
                            row.holderUserId === holderUserId &&
                            row.suspendedReason === reason,
                    ),
                resume: async (resuming: readonly DurableSubscription[]) => {
                    for (const row of resuming) {
                        resumed.push(row.subId);
                        row.suspendedAt = null;
                        row.suspendedReason = null;
                    }
                    return [{ userId, generation: 1 }];
                },
            },
            pendingDelivery: {
                releaseHold: async () => undefined,
                claim: async () => null,
            },
            fsEntry: {
                getEntryByUuid: async (uid: string) =>
                    uid === anchorUid() ? anchorEntry() : null,
                getEntryByPath: async (path: string) =>
                    path === anchorPath() ? anchorEntry() : null,
                getEntryById: async () => null,
            },
            user: {
                getById: async (id: number) => ({ id, uuid: `user-${id}` }),
            },
            app: { getByUid: async (uid: string) => ({ uid, id: 1 }) },
            permission: { getCacheGeneration: async () => 1 },
        } as never,
        {
            eventForward: {
                // A deployment with no peers has nowhere to forward to, which
                // is what every test here is.
                region: 'local',
                isPeer: () => false,
                noteConnect: async () => undefined,
                noteDisconnect: async () => undefined,
                candidateRegion: async () => null,
                fanOut: async () => undefined,
                handOff: () => undefined,
                relayAck: () => undefined,
            },
            socket: { send: vi.fn(), has: () => false },
            fs: { getAncestorChain: async () => [] },
            acl: {
                check: async () => true,
                getSafeAclError: async () => ({
                    status: 404,
                    message: 'Subject does not exist',
                    fields: { code: 'subject_does_not_exist' },
                }),
            },
            notification: { notify: vi.fn() },
            // Background consent is a given here: this suite is about what a
            // plan allows, not about who agreed to it.
            permission: { check: async () => true },
            metering: {
                bufferIncrementUsages: (
                    actor: Actor,
                    usages: UsageInput[],
                ) => {
                    for (const usage of usages)
                        metered.push({
                            userUuid: actor.user?.uuid,
                            ...usage,
                        });
                },
                hasAnyUsageCached: async (actor: Actor) =>
                    solvent.has(Number(actor.user?.id ?? -1)),
                getActorSubscription: async () => ({ id: plan }),
            },
        } as never,
    );
});

describe('a suspension waiting on a balance', () => {
    const suspended = () =>
        durableRow({
            suspendedAt: Math.floor(Date.now() / 1000),
            suspendedReason: 'no_credit',
        });

    it('comes back once the account has budget again', async () => {
        const row = suspended();
        rows.push(row);

        await expect(service.sweepNoCredit()).resolves.toBe(1);
        expect(resumed).toEqual([row.subId]);
        expect(row.suspendedReason).toBeNull();
    });

    it('stays out of service while the account still has none', async () => {
        rows.push(suspended());
        solvent.clear();

        await expect(service.sweepNoCredit()).resolves.toBe(0);
        expect(resumed).toEqual([]);
    });

    it('leaves a suspension it did not cause alone', async () => {
        rows.push(
            durableRow({
                suspendedAt: Math.floor(Date.now() / 1000),
                suspendedReason: 'permission_revoked',
            }),
        );

        await expect(service.sweepNoCredit()).resolves.toBe(0);
        expect(resumed).toEqual([]);
    });
});

describe('what a plan lets an account subscribe to', () => {
    const subscribe = (actor = actorFor()) =>
        service.subscribeDurable(actor, { subject: `fs:${anchorUid()}` });

    it('hands the store the caps the plan resolved to', async () => {
        plan = DEFAULT_FREE_SUBSCRIPTION;

        await subscribe(appActor(`app-${seq}`));

        expect(created[0].limits).toEqual({
            perUser: EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER.bySubscription[
                DEFAULT_FREE_SUBSCRIPTION
            ],
            perApp: EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP.bySubscription[
                DEFAULT_FREE_SUBSCRIPTION
            ],
        });
    });

    it('gives a paid plan the base caps', async () => {
        await subscribe();

        expect(created[0].limits).toEqual({
            perUser: EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER.limit,
            perApp: EVENTS_DURABLE_SUBSCRIPTIONS_PER_APP.limit,
        });
    });

    it('refuses a temporary account outright, with a stable code', async () => {
        plan = DEFAULT_TEMP_SUBSCRIPTION;

        await expect(subscribe()).rejects.toSatisfy(
            codeOf('events_durable_requires_account'),
        );
        expect(created).toEqual([]);
    });
});

describe('the rates this service reports', () => {
    it('names every line it can write, in microcents', () => {
        expect(service.getReportedCosts()).toEqual(
            Object.entries(EVENTS_COSTS).map(([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: expect.any(String),
                source: 'service:events',
            })),
        );
    });
});

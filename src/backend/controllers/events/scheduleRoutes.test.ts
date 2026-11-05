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
 * The schedule routes are thin delegates: without `services.schedules` every
 * one answers 503 `events_disabled`; with it, each hands its request over and
 * answers what it returns.
 */

import type { Request, Response } from 'express';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { makeActor, type Actor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import type {
    ScheduleServiceContract,
    ScheduleView,
} from '../../core/schedules.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { BroadcastController } from '../broadcast/BroadcastController.js';
import type { EventsController } from './EventsController.js';

let server: PuterServer;
let events: EventsController;
let broadcast: BroadcastController;
let actor: Actor;
let saved: unknown;

const SCHEDULE_ID = '0b3a3c9e-9f61-4f0e-8d2a-2f1b6f8f2c11';

const view = {
    scheduleId: SCHEDULE_ID,
    kind: 'recurring',
    appUid: 'app-x',
} as ScheduleView;

const slot = () => server.services as unknown as { schedules?: unknown };
/** Put `schedules` in the slot, or leave the slot empty. */
const setSchedules = (schedules: unknown): void => {
    if (schedules === undefined) delete slot().schedules;
    else slot().schedules = schedules;
};

const fakeSchedules = () =>
    ({
        onSubscriptionsChanged: vi.fn(async () => {}),
        createFor: vi.fn(async () => view),
        list: vi.fn(async () => ({
            items: [view],
            cursor: 'next',
            total: 3,
        })),
        get: vi.fn(async () => view),
        update: vi.fn(async () => view),
        remove: vi.fn(async () => {}),
        receivePeerChanges: vi.fn(async () => ({ applied: 2 })),
        prepareSendAt: vi.fn(),
        createDeferredAppMessage: vi.fn(),
    }) satisfies ScheduleServiceContract;

const req = (init: {
    body?: unknown;
    query?: Record<string, unknown>;
    params?: Record<string, string>;
}): Request =>
    ({
        actor,
        body: init.body ?? {},
        query: init.query ?? {},
        params: init.params ?? {},
        headers: {},
        rawBody: Buffer.from(JSON.stringify(init.body ?? {})),
    }) as unknown as Request;

const res = () => {
    const sent: { status: number; body: unknown } = {
        status: 200,
        body: undefined,
    };
    const response = {
        json: vi.fn((body: unknown) => {
            sent.body = body;
            return response;
        }),
        status: vi.fn((code: number) => {
            sent.status = code;
            return response;
        }),
        setHeader: vi.fn(() => response),
    };
    return { response: response as unknown as Response, sent };
};

/** Each route, called as the router would. */
const routes: Array<[string, (response: Response) => Promise<void>]> = [
    [
        'POST /events/schedules',
        (r) => events.createSchedule(req({ body: { every: 60_000 } }), r),
    ],
    [
        'GET /events/schedules',
        (r) => events.listSchedules(req({ query: { limit: '5' } }), r),
    ],
    [
        'GET /events/schedules/:scheduleId',
        (r) =>
            events.getSchedule(req({ params: { scheduleId: SCHEDULE_ID } }), r),
    ],
    [
        'POST /events/schedules/update',
        (r) => events.updateSchedule(req({ body: { scheduleId: SCHEDULE_ID, changes: { every: '2h' } } }), r),
    ],
    [
        'POST /events/schedules/remove',
        (r) =>
            events.removeSchedule(
                req({ body: { scheduleId: SCHEDULE_ID } }),
                r,
            ),
    ],
    [
        'POST /broadcast/events/schedules',
        (r) =>
            broadcast.schedules(
                req({ body: { namespace: 'n', changes: [] } }),
                r,
            ),
    ],
];

beforeAll(async () => {
    server = await setupTestServer();
    events = server.controllers.events as unknown as EventsController;
    broadcast = server.controllers.broadcast as unknown as BroadcastController;
    actor = makeActor({
        user: { id: 1, uuid: 'u-1', username: 'someone' },
    } as never);
    saved = slot().schedules;
    vi.spyOn(
        server.services.broadcast,
        'verifySignedRequest',
    ).mockResolvedValue({ ok: true, peerId: 'peer' } as never);
});

afterEach(() => {
    setSchedules(saved);
});

afterAll(async () => {
    vi.restoreAllMocks();
    await server?.shutdown();
});

describe('without services.schedules', () => {
    it.each(routes)('%s answers 503 events_disabled', async (_name, call) => {
        setSchedules(undefined);
        const { response } = res();
        let thrown: unknown;
        try {
            await call(response);
        } catch (err) {
            thrown = err;
        }
        expect(isHttpError(thrown)).toBe(true);
        expect(thrown).toMatchObject({
            statusCode: 503,
            legacyCode: 'events_disabled',
            // The designed answer, so it never pages.
            noAlarm: true,
        });
    });

    it('refuses an unsigned peer batch before saying schedules are off', async () => {
        setSchedules(undefined);
        vi.spyOn(
            server.services.broadcast,
            'verifySignedRequest',
        ).mockResolvedValueOnce({
            ok: false,
            status: 401,
            message: 'bad signature',
        } as never);
        const { response, sent } = res();
        await broadcast.schedules(
            req({ body: { namespace: 'n', changes: [] } }),
            response,
        );
        expect(sent.status).toBe(401);
    });
});

describe('with services.schedules', () => {
    it('creates through createFor and answers its view', async () => {
        const schedules = fakeSchedules();
        setSchedules(schedules);
        const { response, sent } = res();
        await events.createSchedule(req({ body: { every: 60_000 } }), response);
        expect(schedules.createFor).toHaveBeenCalledWith(actor, {
            every: 60_000,
        });
        expect(sent.body).toEqual(view);
    });

    it('lists with the limit capped, the cursor and includeTotal', async () => {
        const schedules = fakeSchedules();
        setSchedules(schedules);
        const { response, sent } = res();
        await events.listSchedules(
            req({
                query: { limit: '5000', cursor: 'c', includeTotal: 'true' },
            }),
            response,
        );
        expect(schedules.list).toHaveBeenCalledWith(actor, {
            limit: 200,
            cursor: 'c',
            includeTotal: true,
        });
        expect(sent.body).toEqual({ items: [view], cursor: 'next', total: 3 });
    });

    it('reads one through get', async () => {
        const schedules = fakeSchedules();
        setSchedules(schedules);
        const { response, sent } = res();
        await events.getSchedule(
            req({ params: { scheduleId: SCHEDULE_ID } }),
            response,
        );
        expect(schedules.get).toHaveBeenCalledWith(actor, SCHEDULE_ID);
        expect(sent.body).toEqual(view);
    });

    it('updates through update and answers its view', async () => {
        const schedules = fakeSchedules();
        setSchedules(schedules);
        const { response, sent } = res();
        const changes = { every: '2h' };
        await events.updateSchedule(req({ body: { scheduleId: SCHEDULE_ID, changes } }), response);
        expect(schedules.update).toHaveBeenCalledWith(actor, SCHEDULE_ID, changes);
        expect(sent.body).toEqual(view);
    });

    it('removes through remove and answers {}', async () => {
        const schedules = fakeSchedules();
        setSchedules(schedules);
        const { response, sent } = res();
        await events.removeSchedule(
            req({ body: { scheduleId: SCHEDULE_ID } }),
            response,
        );
        expect(schedules.remove).toHaveBeenCalledWith(actor, SCHEDULE_ID);
        expect(sent.body).toEqual({});
    });

    it('hands a signed peer batch to receivePeerChanges', async () => {
        const schedules = fakeSchedules();
        setSchedules(schedules);
        const { response, sent } = res();
        const body = { namespace: 'n', changes: [] };
        await broadcast.schedules(req({ body }), response);
        expect(schedules.receivePeerChanges).toHaveBeenCalledWith(body);
        expect(sent).toEqual({ status: 200, body: { ok: true, applied: 2 } });
    });
});

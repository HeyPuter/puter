import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import type {
    ScheduleServiceContract,
    ScheduleView,
} from '../../core/schedules.js';
import { EventsController } from './EventsController.js';

const actor = makeActor({
    user: { id: 1, uuid: 'user-1', username: 'user1' } as never,
});
const request = (body: unknown) => ({ actor, body }) as Request;
const controller = (schedules?: Pick<ScheduleServiceContract, 'update'>) =>
    new EventsController(
        {} as never,
        {} as never,
        {} as never,
        { schedules } as never,
        {} as never,
    );

describe('update schedule route contract', () => {
    it('answers events_disabled when schedules are unavailable', async () => {
        await expect(
            controller().updateSchedule(
                request({ scheduleId: 'id', changes: {} }),
                {} as Response,
            ),
        ).rejects.toMatchObject({
            legacyCode: 'events_disabled',
            statusCode: 503,
            noAlarm: true,
        });
    });

    it('passes the actor, id and changes through and returns the updated view', async () => {
        const view = {
            scheduleId: 'id',
            kind: 'recurring',
            state: 'suspended',
        } as ScheduleView;
        const changes = { cron: '0 9 * * *', tz: 'UTC' };
        const calls: unknown[][] = [];
        const events = controller({
            update: async (...args) => {
                calls.push(args);
                return view;
            },
        });
        let sent: unknown;
        await events.updateSchedule(request({ scheduleId: 'id', changes }), {
            json: (value: unknown) => {
                sent = value;
            },
        } as Response);
        expect(calls).toEqual([[actor, 'id', changes]]);
        expect(sent).toBe(view);
    });

    it('preserves validation and sending errors from the implementation', async () => {
        const error = {
            code: 'events_schedule_sending',
            message: 'Already sending',
        };
        await expect(
            controller({
                update: async () => {
                    throw error;
                },
            }).updateSchedule(
                request({ scheduleId: 'id', changes: {} }),
                {} as Response,
            ),
        ).rejects.toBe(error);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterJSError } from '../../lib/PuterJSError.js';

// Every schedule verb goes through the one HTTP helper, so mocking it needs no
// server and still exercises the real request bodies.
const mockRequest = vi.fn();
vi.mock('./lib/api.js', () => ({
    request: (...args) => mockRequest(...args),
}));

const { getSchedule, listSchedules, onSchedule, removeSchedule } =
    await import('./schedules.js');

const HANDLER = ({ event, ctx }) => fetch(ctx.url, { body: event.id });
const SCHEDULE_ID = '2f7c1b6e-4d1a-4c55-9a8e-0e6f3c2b1a90';

const makeModule = () => {
    const module = {
        puter: { APIOrigin: 'https://api.test', fs: { read: vi.fn() } },
        onSchedule,
        listSchedules,
        getSchedule,
        removeSchedule,
    };
    for ( const name of ['onSchedule', 'listSchedules', 'getSchedule', 'removeSchedule'] )
        module[name] = module[name].bind(module);
    return module;
};

const routeOf = (index = 0) => mockRequest.mock.calls[index][1];
const bodyOf = (index = 0) => mockRequest.mock.calls[index][2];
const queryOf = (index = 0) => mockRequest.mock.calls[index][3];

const rejects = async (run) => {
    try {
        await run();
    } catch ( error ) {
        return error;
    }
    throw new Error('expected a rejection');
};

beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
});

describe('onSchedule', () => {
    it('sends the timing options and the handler name, and returns the server`s schedule', async () => {
        const view = { scheduleId: SCHEDULE_ID, kind: 'recurring', nextRunAt: 1 };
        mockRequest.mockResolvedValue(view);

        const schedule = await makeModule().onSchedule({
            cron: '0 9 * * 1-5',
            tz: 'America/New_York',
            startAt: '2026-11-02',
            expiresAt: 1798761600000,
            maxRuns: 10,
            handlerName: 'digest',
            unknownOption: true,
        });

        expect(routeOf()).toBe('/events/schedules');
        expect(bodyOf()).toEqual({
            cron: '0 9 * * 1-5',
            tz: 'America/New_York',
            startAt: '2026-11-02',
            expiresAt: 1798761600000,
            maxRuns: 10,
            handlerName: 'digest',
        });
        expect(schedule).toBe(view);
        expect(schedule.nextRunAt).toBe(1);
    });

    it('passes `every`, `at` and a `Date` through for the server to check', async () => {
        const at = new Date('2026-11-01T18:30:00Z');
        await makeModule().onSchedule({ every: '6h', handlerName: 'poll' });
        await makeModule().onSchedule({ at, handlerName: 'remind' });

        expect(bodyOf(0)).toEqual({ every: '6h', handlerName: 'poll' });
        expect(bodyOf(1)).toEqual({ at, handlerName: 'remind' });
        expect(JSON.parse(JSON.stringify(bodyOf(1))).at).toBe(
            '2026-11-01T18:30:00.000Z',
        );
    });

    it('hands back a handle whose off() removes the schedule', async () => {
        const module = makeModule();
        mockRequest.mockResolvedValueOnce({ scheduleId: SCHEDULE_ID });
        const schedule = await module.onSchedule({ every: '1h', handlerName: 'poll' });

        await schedule.off();

        expect(routeOf(1)).toBe('/events/schedules/remove');
        expect(bodyOf(1)).toEqual({ scheduleId: SCHEDULE_ID });
    });

    it('sends an inline handler as a hash, never as source', async () => {
        const { hashSource } = await import('./lib/handlerSource.js');
        await makeModule().onSchedule({
            every: '1h',
            handlerName: 'poll',
            handler: HANDLER,
        });

        expect(bodyOf().handlerHash).toBe(
            await hashSource(Function.prototype.toString.call(HANDLER)),
        );
        expect(JSON.stringify(bodyOf())).not.toContain('fetch(');
    });

    it('passes a handlerHash given in place of the handler', async () => {
        const handlerHash = 'a'.repeat(64);
        await makeModule().onSchedule({ every: '1h', handlerName: 'poll', handlerHash });
        expect(bodyOf().handlerHash).toBe(handlerHash);
    });

    it('forwards any handlerHash it is given, an empty one included, for the server to judge', async () => {
        await makeModule().onSchedule({ every: '1h', handlerName: 'poll', handlerHash: '' });
        await makeModule().onSchedule({ every: '1h', handlerName: 'poll', handlerHash: null });

        expect(bodyOf(0)).toHaveProperty('handlerHash', '');
        expect(bodyOf(1)).not.toHaveProperty('handlerHash');
    });

    it('needs a handler name before it calls anything', async () => {
        const unnamed = await rejects(() => makeModule().onSchedule({ every: '1h' }));
        expect(unnamed.code).toBe('events_handler_required');

        const inline = await rejects(() =>
            makeModule().onSchedule({ every: '1h', handler: HANDLER }),
        );
        expect(inline.code).toBe('events_handler_name_required');

        const none = await rejects(() => makeModule().onSchedule());
        expect(none.code).toBe('invalid_request');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('refuses a context over the cap before the round trip', async () => {
        const error = await rejects(() =>
            makeModule().onSchedule({
                every: '1h',
                handlerName: 'poll',
                context: { blob: 'x'.repeat(5000) },
            }),
        );
        expect(error.code).toBe('events_context_too_large');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('sends the context it was given', async () => {
        await makeModule().onSchedule({
            every: '1h',
            handlerName: 'poll',
            context: { team: 'design' },
        });
        expect(bodyOf().context).toEqual({ team: 'design' });
    });

    it('passes a server refusal through unchanged, a disabled server included', async () => {
        for ( const code of ['events_disabled', 'events_schedule_invalid', 'events_schedule_busy'] ) {
            const refusal = new PuterJSError('refused', code);
            mockRequest.mockRejectedValueOnce(refusal);
            const error = await rejects(() =>
                makeModule().onSchedule({ every: '1h', handlerName: 'poll' }),
            );
            expect(error).toBe(refusal);
        }
    });
});

describe('listSchedules', () => {
    it('asks for one page, with only the paging options given', async () => {
        const page = { items: [], cursor: 'next' };
        mockRequest.mockResolvedValue(page);

        const result = await makeModule().listSchedules({
            limit: 2,
            cursor: 'abc',
            includeTotal: true,
        });
        await makeModule().listSchedules();
        await makeModule().listSchedules({ cursor: null, includeTotal: false });

        expect(result).toBe(page);
        expect(routeOf(0)).toBe('/events/schedules');
        expect(bodyOf(0)).toBeUndefined();
        expect(queryOf(0)).toEqual({ limit: 2, cursor: 'abc', includeTotal: true });
        expect(queryOf(1)).toEqual({});
        expect(queryOf(2)).toEqual({});
    });

    it('refuses an includeTotal that is not a boolean', async () => {
        const error = await rejects(() =>
            makeModule().listSchedules({ includeTotal: 'yes' }),
        );
        expect(error.code).toBe('invalid_request');
        expect(mockRequest).not.toHaveBeenCalled();
    });
});

describe('getSchedule and removeSchedule', () => {
    it('name the schedule in the path and the body', async () => {
        await makeModule().getSchedule(SCHEDULE_ID);
        await makeModule().removeSchedule(SCHEDULE_ID);

        expect(routeOf(0)).toBe(`/events/schedules/${SCHEDULE_ID}`);
        expect(bodyOf(0)).toBeUndefined();
        expect(routeOf(1)).toBe('/events/schedules/remove');
        expect(bodyOf(1)).toEqual({ scheduleId: SCHEDULE_ID });
    });

    it('keep an id inside its path segment', async () => {
        await makeModule().getSchedule('../subscriptions');
        expect(routeOf()).toBe('/events/schedules/..%2Fsubscriptions');
    });

    it('answer an id that is not one as absent, without a round trip', async () => {
        for ( const id of [undefined, null, '', '  ', 42] ) {
            for ( const verb of ['getSchedule', 'removeSchedule'] ) {
                const error = await rejects(() => makeModule()[verb](id));
                expect(error.code).toBe('events_schedule_not_found');
            }
        }
        expect(mockRequest).not.toHaveBeenCalled();
    });
});

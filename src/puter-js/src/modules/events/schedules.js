import { PuterJSError } from '../../lib/PuterJSError.js';
import { request } from './lib/api.js';
import { prepareHandler, serializeContext } from './lib/handlerSource.js';

/** @typedef {import('./types.js').OnScheduleOptions} OnScheduleOptions */
/** @typedef {import('./types.js').Schedule} Schedule */
/** @typedef {import('./types.js').ScheduleListOptions} ScheduleListOptions */
/** @typedef {import('../../lib/types.js').ListPage<Schedule>} SchedulePage */

/** The options sent as they are; the server validates and rounds them. */
const TIMING_OPTIONS = /** @type {const} */ ([
    'every',
    'cron',
    'tz',
    'at',
    'startAt',
    'expiresAt',
    'maxRuns',
]);

const noSuchSchedule = () =>
    new PuterJSError('No such schedule', 'events_schedule_not_found');

/** @param {unknown} scheduleId */
const assertScheduleId = (scheduleId) => {
    if ( typeof scheduleId !== 'string' || scheduleId.trim().length === 0 ) {
        throw noSuchSchedule();
    }
};

/**
 * Runs the app's published handler on a timer: every interval, on a cron
 * expression in a time zone, or once at a set time. The schedule is stored
 * against the account and runs with nobody present, in the app's events
 * worker, never in this client.
 *
 * Give exactly one of `every`, `cron` or `at`. `handlerName` names the
 * published handler each run calls; passing `handler` too checks that it is
 * the source published under that name.
 *
 * `context` is evaluated **here, now** and delivered to every run as a frozen
 * `ctx`. It can't be changed later: remove the schedule and create a new one.
 *
 * Needs an app, and the account's `events:background` permission for it. On a
 * website with nobody signed in, opens the sign-in first; rejects
 * `auth_canceled` if the visitor closes it.
 *
 * @this {import('./index.js').EventsModule}
 * @param {OnScheduleOptions} options
 * @returns {Promise<Schedule>}
 */
export async function onSchedule (options) {
    const { puter } = this;
    if ( ! options || typeof options !== 'object' ) {
        throw new PuterJSError(
            '`onSchedule()` takes an options object',
            'invalid_request',
        );
    }
    const { handler, handlerName } = options;
    if ( handler !== undefined && handler !== null && ! handlerName ) {
        throw new PuterJSError(
            'An inline `handler` needs a `handlerName` to check it against',
            'events_handler_name_required',
        );
    }
    if ( ! handlerName ) {
        throw new PuterJSError(
            'A schedule needs a `handlerName`',
            'events_handler_required',
        );
    }

    const inline = handler === undefined || handler === null
        ? null
        : await prepareHandler(puter, handler);
    const handlerHash = inline?.hash ?? options.handlerHash;

    /** @type {Record<string, unknown>} */
    const body = { handlerName };
    for ( const key of TIMING_OPTIONS ) {
        if ( options[key] !== undefined && options[key] !== null )
            body[key] = options[key];
    }
    if ( handlerHash ) body.handlerHash = handlerHash;
    // Serialized only to check it against the cap before the round trip.
    if ( serializeContext(options.context) !== undefined )
        body.context = options.context;

    const schedule = /** @type {Schedule} */ (
        await request(puter, '/events/schedules', body)
    );
    schedule.off = async () => this.removeSchedule(schedule.scheduleId);
    return schedule;
}

/**
 * Lists the schedules this caller holds, one page at a time. Ended schedules
 * stay listed for 7 days with why they ended.
 *
 * An app sees only the schedules it created. A session acting for the account
 * sees them all, including ones left behind by an app it no longer uses.
 * `context` values are never returned; a schedule reports its key names and a
 * hash instead.
 *
 * On a website with nobody signed in, opens the sign-in first; rejects
 * `auth_canceled` if the visitor closes it.
 *
 * @this {import('./index.js').EventsModule}
 * @param {ScheduleListOptions} [options]
 * @returns {Promise<SchedulePage>}
 */
export async function listSchedules (options = {}) {
    const { limit, cursor, includeTotal } = options ?? {};
    if ( includeTotal !== undefined && typeof includeTotal !== 'boolean' ) {
        throw new PuterJSError(
            '`includeTotal` must be a boolean',
            'invalid_request',
        );
    }
    return /** @type {SchedulePage} */ (
        /** @type {unknown} */ (
            await request(this.puter, '/events/schedules', undefined, {
                ...(limit !== undefined ? { limit } : {}),
                ...(cursor ? { cursor } : {}),
                ...(includeTotal ? { includeTotal: true } : {}),
            })
        )
    );
}

/**
 * Reads one schedule, ended or not.
 *
 * An id this caller does not hold reads as absent, the same as one that never
 * existed: `events_schedule_not_found`.
 *
 * @this {import('./index.js').EventsModule}
 * @param {string} scheduleId The `scheduleId` of the schedule to read.
 * @returns {Promise<Schedule>}
 */
export async function getSchedule (scheduleId) {
    assertScheduleId(scheduleId);
    return /** @type {Schedule} */ (
        await request(
            this.puter,
            `/events/schedules/${encodeURIComponent(scheduleId)}`,
        )
    );
}

/**
 * Ends a schedule.
 *
 * An id this caller does not hold, or one already ended, reads as absent:
 * `events_schedule_not_found`.
 *
 * @this {import('./index.js').EventsModule}
 * @param {string} scheduleId The `scheduleId` of the schedule to end.
 * @returns {Promise<void>}
 */
export async function removeSchedule (scheduleId) {
    assertScheduleId(scheduleId);
    await request(this.puter, '/events/schedules/remove', { scheduleId });
}

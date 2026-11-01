// Compiled by `npm run check:puterjs:types` against the generated declarations;
// never run. A line marked `@ts-expect-error` must fail to compile.
import type {
    EventHandler,
    OnScheduleOptions,
    Puter,
    ScheduleHandler,
} from '../../index.js';

// A subscription handler reads the fields every subscription event carries.
export const persistent: EventHandler = ({ event }) => event.ts;

export const scheduled: ScheduleHandler = ({ event, ctx }) =>
    `${event.id} ${event.scheduledFor} ${event.attempt} ${String(ctx?.team)}`;

// @ts-expect-error A schedule run has no node to name.
export const noPath: ScheduleHandler = ({ event }) => event.path;

export const options: OnScheduleOptions = {
    every: '6h',
    startAt: new Date(),
    handlerName: 'digest',
    handler: scheduled,
};

// The schedule verbs, unsubscribing, and cancelling a stored notification,
// called on `puter`.
export const onPuter = async (puter: Puter): Promise<void> => {
    const schedule = await puter.events.onSchedule(options);
    await puter.events.getSchedule(schedule.scheduleId);
    const page = await puter.events.listSchedules({ limit: 10 });
    await puter.events.removeSchedule(page.items[0].scheduleId);
    await puter.notifications.cancel(schedule.scheduleId);
    await puter.events.unsubscribe('sub-id');
};

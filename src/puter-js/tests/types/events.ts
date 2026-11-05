// Compiled by `npm run check:puterjs:types` against the generated declarations;
// never run. A line marked `@ts-expect-error` must fail to compile.
import type {
    EventHandler,
    OnScheduleOptions,
    Puter,
    ScheduledNotification,
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
    // The handle onSchedule() returns always has off().
    await schedule.off();
};

// With `sendAt`, notify() resolves to the stored send, or to what an immediate
// send resolves to when `sendAt` is within 5 seconds.
export const notifyLater = async (puter: Puter): Promise<void> => {
    const later: ScheduledNotification | string | void =
        await puter.notifications.notify({ title: 'Hi', sendAt: Date.now() });
    // @ts-expect-error A near or past `sendAt` sends at once instead.
    const stored: ScheduledNotification = await puter.notifications.notify({
        title: 'Hi',
        sendAt: new Date(),
    });
    const uid: string = await puter.notifications.notify({ title: 'Hi' });
    void [later, stored, uid];
};

export const updateSchedules = async (puter: Puter): Promise<void> => {
    const updated = await puter.events.updateSchedule('schedule-id', { cron: '0 9 * * *', tz: 'UTC' });
    const id: string = updated.scheduleId;
    await puter.events.updateSchedule(id, { context: null });
    await puter.events.updateSchedule(id, { sendAt: new Date(), text: null, ttl: null });
    // @ts-expect-error A schedule's handler cannot change.
    await puter.events.updateSchedule(id, { handlerName: 'other' });
    // @ts-expect-error A stored notification's recipient cannot change.
    await puter.events.updateSchedule(id, { to: { handle: 'other' } });
    // @ts-expect-error A send time is a date, string or number.
    await puter.events.updateSchedule(id, { sendAt: true });
};

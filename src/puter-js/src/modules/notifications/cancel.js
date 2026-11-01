/**
 * Cancels a notification `notify()` stored to send later. One that has started
 * sending and isn't finished yet can't be cancelled: `events_schedule_sending`.
 * One already sent or cancelled, or an id this app doesn't hold, reads as
 * `events_schedule_not_found`.
 *
 * @this {import('./index.js').NotificationsModule}
 * @param {string} scheduleId The `scheduleId` `notify()` resolved with.
 * @returns {Promise<void>}
 */
export async function cancel(scheduleId) {
    await this.puter.events.removeSchedule(scheduleId);
}

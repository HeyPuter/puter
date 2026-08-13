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

// A reopen this soon after the app's last dialog activity is a loop, not a
// person: a human has to notice the dialog is gone, find the app's "Send
// feedback" control and click it, which no click-driven flow does inside a
// second.
export const IMMEDIATE_REOPEN_MS = 1000;

// What an app pays for each machine-speed reopen, in order.
export const BACKOFF_MS = [10_000, 60_000, Infinity];

/**
 * Abuse guard for the app-triggered feedback dialog (`showFeedbackDialog`).
 *
 * The dialog is a full-viewport modal an app can open with no user gesture, so
 * an unguarded loop of `showFeedbackDialog()` calls would cover the desktop —
 * taskbar and the app's own close button included — forever.
 *
 * The guard keys off *how fast the app comes back*, never off how many times
 * the user said no. Closing the dialog must not cost the user their next one:
 * people close it by accident, or open it to see what it asks before they have
 * anything to write, and the app's own "Send feedback" button has to keep
 * working when they come back to it.
 *
 * So a reopen that lands within `IMMEDIATE_REOPEN_MS` of the app's last dialog
 * activity — its last dismissal, or its last attempt while backed off — is
 * refused and backs the app off (10s, then 60s, then blocked until the page
 * reloads). Hammering the guard while it is closed counts as activity too, so
 * waiting a backoff out is not a way around the escalation. Any human-paced
 * reopen clears the app's record: the tiers are only ever reached by an app
 * that reopens at machine speed several times over.
 *
 * One dialog may be open at a time, across all apps.
 *
 * @param {{ now?: () => number }} [deps] - `now` is injectable for tests.
 */
export const createFeedbackDialogGuard = ({ now = () => Date.now() } = {}) => {
    let dialog_open = false;
    // app uid/name -> { strikes, until, last_activity }
    const records = new Map();

    return {
        /**
         * May this app open the dialog right now? Records the attempt either
         * way, so call it once per request and honor the answer.
         *
         * @param {string} key - App uid, or name when there is no uid.
         * @returns {boolean}
         */
        mayOpen (key) {
            // Not the app's doing — another dialog is up — so this attempt
            // earns no strike and does not count as activity.
            if ( dialog_open ) return false;

            const record = records.get(key);
            if ( ! record ) return true;

            const t = now();
            const quiet_for = t - record.last_activity;
            record.last_activity = t;

            if ( t < record.until ) return false;

            if ( quiet_for > IMMEDIATE_REOPEN_MS ) {
                records.delete(key);
                return true;
            }

            record.strikes += 1;
            record.until = t + BACKOFF_MS[
                Math.min(record.strikes, BACKOFF_MS.length) - 1
            ];
            return false;
        },

        /**
         * The dialog is up for this app (call only after `mayOpen` said yes).
         */
        markOpened () {
            dialog_open = true;
        },

        /**
         * The dialog is down. A submitted message clears the app's record
         * outright — an app whose users are actually sending feedback is not
         * the app this guard is for.
         *
         * @param {string} key - The key passed to `mayOpen`.
         * @param {boolean} sent - Did the user submit feedback?
         */
        markClosed (key, sent) {
            dialog_open = false;
            if ( sent === true ) {
                records.delete(key);
                return;
            }
            const record = records.get(key) ?? { strikes: 0, until: 0 };
            record.last_activity = now();
            records.set(key, record);
        },
    };
};

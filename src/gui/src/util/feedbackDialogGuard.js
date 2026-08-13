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
 * Re-entry guard for the app-triggered feedback dialog
 * (`puter.ui.showFeedbackDialog`).
 *
 * There is exactly one rule: one dialog at a time. A second one would stack a
 * full-viewport overlay on top of the first, and closing the top one would
 * leave the user staring at another.
 *
 * There is deliberately no rate limit. Rate limiting this dialog cost real
 * users their "Send feedback" button — a dismissal, or a reopen the guard read
 * as too quick, silently turned the next call into a no-op, and an app has no
 * way to tell that from the user closing the dialog. The neighboring modals an
 * app can open with no user gesture (`requestPermission`, `alert`, `prompt`)
 * have no rate limit either, so this one is not the place to hold that line: a
 * nagging app is a policy problem, not something to solve by breaking the
 * button for everyone else.
 */
export const createFeedbackDialogGuard = () => {
    let dialog_open = false;

    return {
        /**
         * May the dialog open right now?
         *
         * @returns {boolean} false only while another dialog is up.
         */
        mayOpen () {
            return ! dialog_open;
        },

        /** The dialog is up (call only after `mayOpen` said yes). */
        markOpened () {
            dialog_open = true;
        },

        /**
         * The dialog is down. Must run on every exit path — a dialog left
         * marked open blocks every later one.
         */
        markClosed () {
            dialog_open = false;
        },
    };
};

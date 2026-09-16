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
 * Whether closing the tab right now would destroy work in progress, so the
 * browser should put its "leave site?" dialog in the way first.
 *
 * Uploads stream from this page, so they die with it — a nearly-finished
 * upload has to start over. Downloads are handed to the browser's own
 * downloader and outlive the tab, so they don't count.
 *
 * @param {{ activeUploadCount?: number, openWindowCount?: number, promptOnOpenWindows?: boolean }} state
 * @returns {boolean}
 */
export const should_confirm_before_unload = ({
    activeUploadCount = 0,
    openWindowCount = 0,
    promptOnOpenWindows = false,
} = {}) => {
    if ( activeUploadCount > 0 ) return true;
    return promptOnOpenWindows && openWindowCount > 0;
};

/**
 * `beforeunload` handler reading the live globals. Returning a truthy value is
 * what triggers the dialog; its wording is the browser's, not ours.
 *
 * @returns {true|undefined}
 */
export const confirm_before_unload = () => {
    const confirm = should_confirm_before_unload({
        activeUploadCount: Object.keys(window.active_uploads ?? {}).length,
        // Explorer windows hold nothing unsaved, so they don't warrant a prompt.
        openWindowCount: $('.window:not(.window[data-app="explorer"])').length,
        promptOnOpenWindows: Boolean(window.feature_flags?.prompt_user_when_navigation_away_from_puter),
    });

    return confirm ? true : undefined;
};

export default confirm_before_unload;

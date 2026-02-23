/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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

import TeePromise from './TeePromise.js';

/**
 * This file contains common functions that are used to re-authenticate an
 * OIDC-authenticated user when performing actions on protected endpoints.
 *
 * No design patterns, no abstractions; only simple functions.
 * (this is not merely a description; it is a guideline for future changes)
 */

const POPUP_FEATURES = 'width=500,height=600';

export const openRevalidatePopup = async (revalidateUrl) => {
    const donePromise = new TeePromise();

    const url = revalidateUrl;
    if ( ! url ) {
        throw new Error('No revalidate URL');
    }
    let doneCalled = false;
    const popup = window.open(url, 'puter-revalidate', POPUP_FEATURES);
    const onMessage = ev => {
        if ( (ev.origin !== window.gui_origin) && (ev.origin !== window.location.origin) ) return;
        if ( !ev.data || ev.data.type !== 'puter-revalidate-done' ) return;
        if ( doneCalled ) return;
        doneCalled = true;
        window.removeEventListener('message', onMessage);
        donePromise.resolve();
    };
    window.addEventListener('message', onMessage);
    const checkClosed = setInterval(() => {
        if ( popup && popup.closed ) {
            clearInterval(checkClosed);
            window.removeEventListener('message', onMessage);
            if ( ! doneCalled ) {
                doneCalled = true;
                donePromise.reject(new Error('Popup closed'));
            }
        }
    }, 300);
    await donePromise;
};

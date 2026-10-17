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

import { appHoldsPermissions as defaultAppHoldsPermissions } from './holdsPermissions.js';

/**
 * The open app window for an instance: the iframe to post to, and the app
 * running in it. `null` once the window is gone.
 *
 * @param {string} appInstanceID
 * @returns {{ contentWindow: Window, appUid: string | undefined } | null}
 */
const defaultFindWatcher = (appInstanceID) => {
    const contentWindow = window.iframe_for_app_instance(appInstanceID)?.contentWindow;
    if ( ! contentWindow ) return null;
    const appUid = $(window.window_for_app_instance(appInstanceID)).attr('data-app_uuid');
    return { contentWindow, appUid };
};

/**
 * App watchers for file changes the desktop makes (rename, move, write).
 *
 * An app only hears about a file it can see. A watch is the app asking to be
 * told about some uid, and the uid alone is no proof of access, so the grant
 * is checked before the watch is taken — and again before every event, since
 * a share can be revoked while the app keeps its window open. Any check that
 * can't be answered counts as not held, and the watcher is dropped.
 *
 * @param {object} [deps] Injectable seams for tests.
 * @param {typeof defaultAppHoldsPermissions} [deps.appHoldsPermissions]
 * @param {typeof defaultFindWatcher} [deps.findWatcher]
 */
export const createItemWatchers = ({
    appHoldsPermissions = defaultAppHoldsPermissions,
    findWatcher = defaultFindWatcher,
} = {}) => {
    /** @type {Map<string, Set<string>>} item uid → app instance ids */
    const watchers = new Map();
    /** @type {Map<string, Promise<void>>} per-uid delivery, in event order */
    const deliveries = new Map();

    const canSee = (item_uid, appUid) =>
        appHoldsPermissions([`fs:${item_uid}:see`], appUid);

    const drop = (item_uid, appInstanceID) => {
        const set = watchers.get(item_uid);
        if ( ! set ) return;
        set.delete(appInstanceID);
        if ( set.size === 0 ) watchers.delete(item_uid);
    };

    /**
     * @param {string} item_uid
     * @param {string} appInstanceID
     * @param {string} appUid - The app running in that instance.
     * @returns {Promise<boolean>} Whether the watch was taken.
     */
    const add = async (item_uid, appInstanceID, appUid) => {
        if ( typeof item_uid !== 'string' || ! item_uid ) return false;
        if ( typeof appInstanceID !== 'string' || ! appInstanceID ) return false;
        if ( ! await canSee(item_uid, appUid) ) return false;
        if ( ! watchers.has(item_uid) ) watchers.set(item_uid, new Set());
        watchers.get(item_uid).add(appInstanceID);
        return true;
    };

    const deliver = async (item_uid, event_data) => {
        const ids = [...(watchers.get(item_uid) ?? [])];
        await Promise.all(ids.map(async (appInstanceID) => {
            const target = findWatcher(appInstanceID);
            // Asked of the window's app now, not the one that took the watch.
            if ( !target || !await canSee(item_uid, target.appUid) ) {
                drop(item_uid, appInstanceID);
                return;
            }
            target.contentWindow.postMessage({
                msg: 'itemChanged',
                data: event_data,
            }, '*');
        }));
    };

    /**
     * @param {string} item_uid
     * @param {object} event_data
     * @returns {Promise<void>} Settles once this event has been delivered.
     */
    const notify = (item_uid, event_data) => {
        if ( ! watchers.has(item_uid) ) return Promise.resolve();
        // Chained so a rename followed by a write arrives in that order,
        // whichever permission check answers first.
        const next = (deliveries.get(item_uid) ?? Promise.resolve())
            .then(() => deliver(item_uid, event_data))
            .catch((e) => console.error('Failed to notify item watchers', e));
        deliveries.set(item_uid, next);
        next.then(() => {
            if ( deliveries.get(item_uid) === next ) deliveries.delete(item_uid);
        });
        return next;
    };

    return { add, notify };
};

const itemWatchers = createItemWatchers();

export const addItemWatcher = itemWatchers.add;
export const notifyItemWatchers = itemWatchers.notify;

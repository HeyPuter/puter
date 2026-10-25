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

// Profile pictures for the dashboard's people avatars. An avatar renders as
// its initial; marked with avatarUserAttr, paintAvatars lays the person's
// picture over it once one arrives, and leaves the initial when none does.

// Pictures change rarely; long enough that re-rendering a listing is free.
const TTL = 5 * 60 * 1000;
// Each entry holds a data URL, so the cache stays small.
const MAX_ENTRIES = 100;
// A Shared view can name dozens of people; don't fire a lookup for each at once.
const MAX_CONCURRENT = 4;

const DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;

/** @type {Map<string, { at: number, promise: Promise<string | null> }>} */
const cache = new Map();

let active = 0;
/** @type {Array<() => void>} */
const waiting = [];

/**
 * Runs `task` once fewer than MAX_CONCURRENT others are running.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
const limited = (task) => new Promise((resolve, reject) => {
    const run = () => {
        active++;
        task().then(resolve, reject).finally(() => {
            active--;
            waiting.shift()?.();
        });
    };
    if ( active < MAX_CONCURRENT ) run();
    else waiting.push(run);
});

/**
 * `username`'s profile picture as a data URL, or null when there is none to
 * show (no picture, not public to us, or the lookup failed). Lookups are
 * cached and shared between callers. Never rejects.
 *
 * @param {string} username
 * @returns {Promise<string | null>}
 */
export const profilePicture = (username) => {
    if ( ! username ) return Promise.resolve(null);
    // Read live, so a picture changed in the Account tab shows at once.
    if ( username === window.user?.username ) {
        const picture = window.user?.profile?.picture;
        return Promise.resolve(typeof picture === 'string' && DATA_URL.test(picture) ? picture : null);
    }

    const now = Date.now();
    const hit = cache.get(username);
    if ( hit && now - hit.at < TTL ) {
        // Re-insert so eviction drops the least recently used first.
        cache.delete(username);
        cache.set(username, hit);
        return hit.promise;
    }

    const promise = limited(() => window.get_profile_picture(username))
        .then((picture) => (typeof picture === 'string' && DATA_URL.test(picture) ? picture : null))
        .catch(() => null);
    cache.delete(username);
    cache.set(username, { at: now, promise });
    while ( cache.size > MAX_ENTRIES ) cache.delete(cache.keys().next().value);
    return promise;
};

/**
 * Marks an avatar as `username`'s, for paintAvatars. Goes inside the avatar
 * element's opening tag.
 *
 * @param {string} username
 * @returns {string} markup
 */
export const avatarUserAttr = (username) => (username
    ? ` data-avatar-user="${window.html_encode(username)}"`
    : '');

/**
 * Lays `picture` over the avatar's initial. A picture that fails to decode is
 * dropped, and not looked up again until the cache entry expires.
 *
 * @param {HTMLElement} el
 * @param {string} username
 * @param {string} picture
 */
const applyPicture = (el, username, picture) => {
    if ( ! el.isConnected || el.classList.contains('has-picture') ) return;
    const img = document.createElement('img');
    img.className = 'avatar-picture';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.addEventListener('error', () => {
        img.remove();
        el.classList.remove('has-picture');
        cache.set(username, { at: Date.now(), promise: Promise.resolve(null) });
    }, { once: true });
    // Set as a property, never through markup.
    img.src = picture;
    el.classList.add('has-picture');
    el.appendChild(img);
};

/**
 * Fills every marked avatar under `root` that has no picture yet.
 *
 * @param {ParentNode} root
 */
const paintNow = (root) => {
    /** @type {Map<string, HTMLElement[]>} */
    const byUser = new Map();
    for ( const el of root.querySelectorAll('[data-avatar-user]:not(.has-picture)') ) {
        const username = el.getAttribute('data-avatar-user');
        if ( ! byUser.has(username) ) byUser.set(username, []);
        byUser.get(username).push(el);
    }
    for ( const [username, els] of byUser ) {
        profilePicture(username).then((picture) => {
            if ( ! picture ) return;
            for ( const el of els ) applyPicture(el, username, picture);
        });
    }
};

/** @type {Set<ParentNode>} */
const pendingRoots = new Set();
let frame = 0;

/**
 * Fills the marked avatars under `root` with pictures. Calls made in the same
 * frame are folded into one pass, so a listing that renders row by row can
 * call it per row.
 *
 * @param {ParentNode | null | undefined} root
 */
export const paintAvatars = (root) => {
    if ( ! root ) return;
    pendingRoots.add(root);
    if ( frame ) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        for ( const r of roots ) paintNow(r);
    });
};

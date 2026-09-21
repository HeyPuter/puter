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

// Who the user last shared with, so the recipient field can offer them again.
// Kept in the account's own key-value store rather than localStorage, so the
// list follows the user between browsers the way their other preferences do.

/**
 * A recipient worth offering again. `kind` matches the access list's row kinds
 * so the two can be compared by key.
 *
 * @typedef {Object} RecentRecipient
 * @property {'user'|'invite'|'team'} kind
 * @property {string} id - Username, invited email address, or team uid
 * @property {string} name - What to show; the id itself for a person
 */

const KV_KEY = 'recent_share_recipients';

/** A shortcut, not an address book: enough to cover who you share with weekly. */
export const MAX_RECENTS = 20;

const KINDS = new Set(['user', 'invite', 'team']);

/**
 * The entries of `value` that are usable, capped. Anything else in the key —
 * a shape from an older build, or a value written by hand — is dropped rather
 * than rendered.
 *
 * @param {unknown} value
 * @returns {RecentRecipient[]}
 */
export const sanitize_recents = (value) => {
    if ( ! Array.isArray(value) ) return [];
    const out = [];
    const seen = new Set();
    for ( const entry of value ) {
        if ( ! KINDS.has(entry?.kind) ) continue;
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if ( id === '' ) continue;
        const key = `${entry.kind}:${id.toLowerCase()}`;
        if ( seen.has(key) ) continue;
        seen.add(key);
        out.push({
            kind: entry.kind,
            id,
            name: typeof entry.name === 'string' && entry.name.trim() !== ''
                ? entry.name
                : id,
        });
        if ( out.length === MAX_RECENTS ) break;
    }
    return out;
};

/**
 * `list` with `entry` moved (never duplicated) to the front, capped.
 *
 * @param {RecentRecipient[]} list
 * @param {RecentRecipient} entry
 * @returns {RecentRecipient[]}
 */
export const merge_recent = (list, entry) => {
    const clean = sanitize_recents([entry]);
    if ( clean.length === 0 ) return sanitize_recents(list);
    const key = `${clean[0].kind}:${clean[0].id.toLowerCase()}`;
    const rest = sanitize_recents(list).filter(
        (item) => `${item.kind}:${item.id.toLowerCase()}` !== key,
    );
    return [clean[0], ...rest].slice(0, MAX_RECENTS);
};

/** Read once per session; every dialog after the first opens on what's here. */
let cached = null;

/**
 * The recipients this account last shared with, most recent first. Never
 * rejects: a store that is unreachable or empty means "suggest nothing".
 *
 * @returns {Promise<RecentRecipient[]>}
 */
export const recent_recipients = () => {
    cached ??= (async () => {
        try {
            return sanitize_recents(await puter.kv.get(KV_KEY));
        } catch {
            return [];
        }
    })();
    return cached;
};

/**
 * Record a successful share so the recipient comes up first next time.
 * Best-effort: a store that refuses the write costs the user nothing.
 *
 * @param {RecentRecipient} entry
 * @returns {Promise<RecentRecipient[]>} the list as it now stands
 */
export const remember_recipient = async (entry) => {
    const next = merge_recent(await recent_recipients(), entry);
    cached = Promise.resolve(next);
    try {
        await puter.kv.set(KV_KEY, next);
    } catch { /* the in-memory list still serves this session */ }
    return next;
};

/** Drops the session cache. For tests, and for a change of signed-in user. */
export const forget_recent_recipients = () => {
    cached = null;
};

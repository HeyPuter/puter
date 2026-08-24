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

// Folds the per-item share listings behind the share dialog into one row per
// person, so a selection of many items reads as a single access list. Pure, so
// the rules that decide what a row may change are testable without a DOM.

/**
 * One person's standing across every item the dialog covers.
 *
 * A person's grants split three ways, and only the first is changeable here:
 * `direct` are grants on the items themselves, `inherited` come through an
 * ancestor folder and belong to that folder, `pending` are invitations to an
 * email with no account behind it yet. A key is either a username or an
 * invited email, never both, so `directPaths` and `pendingPaths` never both
 * have entries.
 *
 * @typedef {Object} ShareGroup
 * @property {string} key - Row identity: `user:<username>` or `invite:<email>`
 * @property {string} name - Username, or the invited email address
 * @property {boolean} pending - Invitation with no account behind it yet
 * @property {string[]} directPaths - Items whose grant this dialog can change
 * @property {string[]} pendingPaths - Items the invitation covers
 * @property {string[]} inheritedPaths - Items reached through an ancestor
 * @property {string|null} mode - Mode of the direct grants, null when they disagree
 * @property {string|null} pendingMode - Mode of the invitations, null when they disagree
 * @property {string|null} inheritedMode - Mode of the inherited grants, null when they disagree
 * @property {string|null} inheritedFrom - The one ancestor every inherited grant
 *   comes through, null when there is more than one
 * @property {number} accessCount - Items the person can reach, by any of the three
 */

/**
 * The one value every entry shares, or null when they disagree (or there are none).
 *
 * @param {Array<string|null|undefined>} values
 * @returns {string|null}
 */
const uniform = (values) => {
    if ( values.length === 0 ) return null;
    const first = values[0] ?? null;
    return values.every((value) => (value ?? null) === first) ? first : null;
};

/**
 * Which of the three buckets a share row belongs to. Pending wins over
 * inherited: an invitation carries no username to hang an inherited row on.
 *
 * @param {Object} share
 * @returns {'pending'|'inherited'|'direct'}
 */
const bucket_of = (share) => {
    if ( share.pending ) return 'pending';
    if ( share.inheritedFrom ) return 'inherited';
    return 'direct';
};

/**
 * Collapses per-item share listings into one {@link ShareGroup} per person.
 *
 * Groups come back in the order the listings first mention each person, which
 * keeps the list stable across refreshes. Items with no listing (a request
 * that failed, say) simply contribute nothing.
 *
 * @param {string[]} paths - The items the dialog covers, in display order
 * @param {Map<string, Object[]>} sharesByPath - Each item's `getShares` result
 * @returns {ShareGroup[]}
 */
export const aggregateShares = (paths, sharesByPath) => {
    /** @type {Map<string, Object>} */
    const groups = new Map();

    for ( const item_path of paths ) {
        // The same person can hold more than one grant on an item (different
        // issuers), which must not count as reaching it twice.
        const counted = new Set();

        for ( const share of sharesByPath.get(item_path) ?? [] ) {
            const bucket = bucket_of(share);
            const name = bucket === 'pending'
                ? (share.recipientEmail ?? '')
                : (share.holder ?? '');
            if ( name === '' ) continue;

            const key = `${bucket === 'pending' ? 'invite' : 'user'}:${name}`;
            if ( counted.has(`${key}|${bucket}`) ) continue;
            counted.add(`${key}|${bucket}`);

            if ( ! groups.has(key) ) {
                groups.set(key, {
                    key,
                    name,
                    pending: bucket === 'pending',
                    directPaths: [],
                    pendingPaths: [],
                    inheritedPaths: [],
                    _directModes: [],
                    _pendingModes: [],
                    _inheritedModes: [],
                    _inheritedFroms: [],
                });
            }
            const group = groups.get(key);

            if ( bucket === 'pending' ) {
                group.pendingPaths.push(item_path);
                group._pendingModes.push(share.mode);
            } else if ( bucket === 'inherited' ) {
                group.inheritedPaths.push(item_path);
                group._inheritedModes.push(share.mode);
                group._inheritedFroms.push(share.inheritedFrom);
            } else {
                group.directPaths.push(item_path);
                group._directModes.push(share.mode);
            }
        }
    }

    return [...groups.values()].map((group) => {
        const reached = new Set([
            ...group.directPaths,
            ...group.pendingPaths,
            ...group.inheritedPaths,
        ]);
        return {
            key: group.key,
            name: group.name,
            pending: group.pending,
            directPaths: group.directPaths,
            pendingPaths: group.pendingPaths,
            inheritedPaths: group.inheritedPaths,
            mode: uniform(group._directModes),
            pendingMode: uniform(group._pendingModes),
            inheritedMode: uniform(group._inheritedModes),
            inheritedFrom: uniform(group._inheritedFroms),
            accessCount: reached.size,
        };
    });
};

/**
 * The items a person cannot reach at all — what "add to all" would grant.
 *
 * @param {string[]} paths - The items the dialog covers
 * @param {ShareGroup} group
 * @returns {string[]}
 */
export const missingPathsFor = (paths, group) => {
    const reached = new Set([
        ...group.directPaths,
        ...group.pendingPaths,
        ...group.inheritedPaths,
    ]);
    return paths.filter((item_path) => ! reached.has(item_path));
};

/**
 * Distinct owners of a selection, in first-seen order, with how many items each
 * one owns. A multi-item selection made in the Shared view can span owners.
 *
 * @param {Array<string|null>} owners - One owner per item, in display order
 * @returns {Array<{ name: string, count: number }>}
 */
export const aggregateOwners = (owners) => {
    /** @type {Map<string, {name: string, count: number}>} */
    const seen = new Map();
    for ( const owner of owners ) {
        if ( ! owner ) continue;
        const entry = seen.get(owner) ?? { name: owner, count: 0 };
        entry.count++;
        seen.set(owner, entry);
    }
    return [...seen.values()];
};

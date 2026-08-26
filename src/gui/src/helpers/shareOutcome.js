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
 * What a share call actually did, so the dialog can say so. A backend that
 * omits `isNew` reads as `shared`, which is what these dialogs said before it.
 *
 * @param {Array<{ pending?: boolean, isNew?: boolean, mode?: string, holder?: string|null }>} created
 * @param {Array<{ holder?: string|null, mode?: string, inheritedFrom?: string|null }>} [before]
 * @returns {'invited' | 'shared' | 'updated' | 'unchanged'}
 */
export const share_outcome = (created, before = []) => {
    const list = Array.isArray(created) ? created.filter(Boolean) : [];
    if ( list.some((share) => share.pending) ) return 'invited';
    if ( list.length === 0 || list.some((share) => share.isNew !== false) ) {
        return 'shared';
    }

    // Matched on the resolved username rather than what was typed, so an email
    // that belongs to a known account still finds their row.
    const previous = (Array.isArray(before) ? before : []).find(
        (share) =>
            share?.holder &&
            list.some((made) => made.holder === share.holder) &&
            ! share.inheritedFrom,
    );
    if ( ! previous ) return 'unchanged';
    return list.some((made) => made.mode !== previous.mode)
        ? 'updated'
        : 'unchanged';
};

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

// Who shared each item in the Files tab's Shared view: the row's "Shared by"
// cell and the people filter above the listing.

import { avatarHue, avatarInitial } from '../../helpers/shareAvatar.js';

/**
 * @typedef {{ shared_by?: string | null, owner?: string | null }} SharedRow
 * @typedef {{ name: string, count: number }} Sharer
 */

/**
 * The person who shared a Shared-view row with the user. A grant recorded
 * without an issuer falls back to the item's owner.
 *
 * @param {SharedRow} [row]
 * @returns {string} username, or '' when the row names nobody
 */
export const sharerOf = (row) => row?.shared_by || row?.owner || '';

/**
 * Everyone who shared something in `rows`, with how many items each, most
 * items first and ties by name.
 *
 * @param {SharedRow[]} rows
 * @returns {Sharer[]}
 */
export const summarizeSharers = (rows) => {
    const counts = new Map();
    for ( const row of rows ) {
        const name = sharerOf(row);
        if ( name ) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || compareNames(a.name, b.name));
};

/**
 * The rows `sharer` shared; every row when `sharer` is empty.
 *
 * @template {SharedRow} T
 * @param {T[]} rows
 * @param {string | null} [sharer]
 * @returns {T[]}
 */
export const filterBySharer = (rows, sharer) => (sharer
    ? rows.filter((row) => sharerOf(row) === sharer)
    : rows);

/**
 * Orders two rows by who shared them, case-insensitively.
 *
 * @param {SharedRow} a
 * @param {SharedRow} b
 * @returns {number}
 */
export const compareSharers = (a, b) => compareNames(sharerOf(a), sharerOf(b));

// One collator for every comparison: localeCompare with options builds a new
// one per call, which made sorting a large Shared listing over 20x slower.
const compareNames = new Intl.Collator(undefined, { sensitivity: 'base' }).compare;

/**
 * The "Shared by" column's width beside an auto-width name column: `width`,
 * held to 40% of the `room` the two split so the name keeps the larger part,
 * and never under the 60px every resizable column keeps.
 *
 * @param {number} width
 * @param {number} room
 * @returns {number}
 */
export const fitSharedByWidth = (width, room) => Math.max(60, Math.min(width, Math.floor(room * 0.4)));

/**
 * The initial-and-color avatar the share modal uses, sized by `className`.
 *
 * @param {string} name
 * @param {string} className
 * @returns {string} markup
 */
const avatarHtml = (name, className) => `<span class="${className}" style="--share-avatar-hue: ${avatarHue(name)}" aria-hidden="true">${window.html_encode(avatarInitial(name))}</span>`;

/**
 * Tooltip for a row's sharer, naming the owner too when someone else re-shared it.
 *
 * @param {SharedRow} row
 * @returns {string} plain text
 */
export const sharedByTitle = (row) => {
    const username = sharerOf(row);
    if ( ! username ) return '';
    return row.owner && row.owner !== username
        ? i18n('shared_by_user_owned_by', { username, owner: row.owner }, false)
        : i18n('shared_by_user', { username }, false);
};

/**
 * A row's "Shared by" cell. Rendered empty when the row names nobody, so the
 * list view's columns still line up.
 *
 * @param {SharedRow} row
 * @returns {string} markup
 */
export const sharedByCellHtml = (row) => {
    const name = sharerOf(row);
    if ( ! name ) return '<div class="item-shared-by"></div>';
    return `<div class="item-shared-by" title="${window.html_encode(sharedByTitle(row))}">`
        + avatarHtml(name, 'item-shared-by-avatar')
        + `<span class="item-shared-by-name">${window.html_encode(name)}</span>`
        + '</div>';
};

/**
 * The people filter's chips: "Everyone", then one per sharer. Empty with
 * fewer than two sharers, where filtering would change nothing.
 *
 * @param {Sharer[]} sharers - From summarizeSharers
 * @param {string | null} active - The sharer filtered to, or null for everyone
 * @returns {string} markup
 */
export const sharerFilterHtml = (sharers, active) => {
    if ( sharers.length < 2 ) return '';
    const total = sharers.reduce((sum, sharer) => sum + sharer.count, 0);
    const chip = (value, inner, count, title) => {
        const pressed = (active ?? '') === value;
        return `<button type="button" class="sharer-chip${pressed ? ' active' : ''}" data-sharer="${window.html_encode(value)}" aria-pressed="${pressed}"${title ? ` title="${window.html_encode(title)}"` : ''}>`
            + inner
            + `<span class="sharer-chip-count">${count}</span>`
            + '</button>';
    };
    let h = chip('', `<span class="sharer-chip-label">${i18n('shared_filter_everyone')}</span>`, total);
    for ( const { name, count } of sharers ) {
        h += chip(
            name,
            avatarHtml(name, 'sharer-chip-avatar') + `<span class="sharer-chip-label">${window.html_encode(name)}</span>`,
            count,
            i18n('shared_by_user', { username: name }, false),
        );
    }
    return h;
};

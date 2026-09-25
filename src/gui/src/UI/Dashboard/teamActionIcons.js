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

// A row carries up to five actions, and five labelled buttons do not fit.
// Inline like the sidebar chevron: one-place glyphs, not shared assets.

const SVG = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const TEAM_ACTION_ICONS = {
    /** Change plan — a card. */
    plan: SVG('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    /** Reissue credential — a key. */
    credential: SVG('<circle cx="8" cy="12" r="4"/><path d="M12 12h9"/><path d="M17 12v4"/><path d="M20 12v3"/>'),
    /** Suspend — pause. */
    suspend: SVG('<rect x="7" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
    /** Re-enable — play. */
    enable: SVG('<path d="M7 5l12 7-12 7z"/>'),
    /** Delete the account — a bin. */
    remove: SVG('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>'),
    /** Edit the account — a pencil. */
    edit: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
};

/** The label stays as tooltip and screen-reader text, so nothing is lost. */
export const teamActionButton = ({ className, icon, label, danger, attrs }) => {
    const safeLabel = window.html_encode(label);
    const extra = Object.entries(attrs ?? {})
        .map(([k, v]) => ` ${k}="${window.html_encode(v ?? '')}"`)
        .join('');
    return (
        `<button class="button button-small button-icon ${className}` +
        `${danger ? ' button-danger' : ''}" title="${safeLabel}"` +
        ` aria-label="${safeLabel}"${extra}>` +
        `${TEAM_ACTION_ICONS[icon] ?? ''}` +
        `<span class="sr-only">${safeLabel}</span></button>`
    );
};

export default teamActionButton;

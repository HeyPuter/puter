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
 * The team name under the sidebar wordmark. Empty for anyone but a seat —
 * `whoami` sets `team` only for an account a team pays for.
 *
 * @param {object} [user] `window.user`
 * @returns {string} markup, or '' when there is nothing to say
 */
export const teamBadgeHtml = (user) => {
    const name = user?.team?.name;
    if ( typeof name !== 'string' || name.trim() === '' ) return '';
    const label = window.html_encode(name);
    const title = window.html_encode(i18n('teams_account_of', [name]));
    return `<div class="dashboard-sidebar-team" title="${title}">${label}</div>`;
};

export default teamBadgeHtml;

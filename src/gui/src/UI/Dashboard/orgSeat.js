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
 * An account its team created and pays for.
 *
 * whoami sends `team` only for a seat — the owner joined their own team and is
 * never `org_owned` — so its presence is the whole test. One predicate because
 * the surfaces that restrict a seat (billing, plan purchase, username) must
 * agree; the backend refuses each of them regardless.
 *
 * @param {object} [user] - `window.user`.
 * @returns {boolean}
 */
export const isOrgSeat = (user) =>
    typeof user?.team?.uid === 'string' && user.team.uid !== '';

/** The team's name, for telling the user who to ask. */
export const orgSeatTeamName = (user) =>
    (typeof user?.team?.name === 'string' && user.team.name.trim()) || null;

export default isOrgSeat;

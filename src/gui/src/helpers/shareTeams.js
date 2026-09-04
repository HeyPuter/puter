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

/** @typedef {{ uid: string, name?: string | null, handle?: string | null }} Team */

/**
 * The teams the signed-in user can share with, or none.
 *
 * Offers nothing unless `gui_params.teams_ui` is on, so the API can ship
 * ahead of the interface. Beyond that: a deployment with teams off registers
 * no `/teams` route and answers 404, and a user without one gets an empty
 * list. All three mean "offer nothing".
 *
 * @returns {Promise<Team[]>}
 */
export const teams_for_sharing = async () => {
    if ( ! window.teams_ui ) return [];
    try {
        const teams = await puter.teams.list();
        return Array.isArray(teams) ? teams : [];
    } catch (e) {
        return [];
    }
};

/**
 * The team a share is held by, or `null` when a person holds it.
 *
 * A team share names the team in `holderTeam` and leaves `holder`
 * empty, because the holder is not a person. The `holder` fallback covers a
 * listing that reports the team by identifier instead; either way the
 * answer carries a `uid`, which is what a revoke needs.
 *
 * @param {Team[]} teams
 * @param {{ holder?: string | null, holderTeam?: Team | null }} share
 * @returns {Team | null}
 */
export const team_for_share = (teams, share) => {
    if ( share?.holderTeam?.uid ) return share.holderTeam;
    const holder = share?.holder;
    if ( ! holder ) return null;
    return (teams ?? []).find(
        (team) => team.uid === holder || (team.handle && team.handle === holder),
    ) ?? null;
};

/**
 * What to call a team on screen. Falls back through the handle to the
 * uid, so an unnamed team still reads as something rather than as blank.
 *
 * @param {Team} team
 * @returns {string}
 */
export const team_label = (team) =>
    team?.name || team?.handle || team?.uid || '';

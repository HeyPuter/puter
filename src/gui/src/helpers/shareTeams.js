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

// One page per team is enough to suggest from, and it is the route's ceiling —
// without it the SDK walks every page of a large roster.
const MEMBER_PAGE_CAP = 200;

/** Rosters change rarely; long enough that reopening the dialog is free. */
const COLLEAGUE_TTL = 5 * 60 * 1000;

/** @type {{ key: string, at: number, promise: Promise<Colleague[]> } | null} */
let colleague_cache = null;

/** @typedef {{ username: string, teamName: string | null }} Colleague */

/**
 * The people in `teams`, deduplicated across them and named by the first team
 * they were found in — the pool the sharing dialogs suggest from.
 *
 * Never rejects: a roster the caller may not read (an unverified account, an
 * older SDK, a deployment with teams off) means "suggest nobody". A lookup that
 * failed outright is not cached, so the next dialog tries again.
 *
 * @param {Team[]} teams
 * @returns {Promise<Colleague[]>}
 */
export const colleagues_for_sharing = async (teams) => {
    const list = Array.isArray(teams) ? teams.filter((team) => team?.uid) : [];
    if ( list.length === 0 ) return [];

    const key = list.map((team) => team.uid).sort().join(',');
    const now = Date.now();
    if ( colleague_cache?.key === key && now - colleague_cache.at < COLLEAGUE_TTL ) {
        return colleague_cache.promise;
    }

    const promise = (async () => {
        // One team's roster being out of reach must not withhold the others.
        let settled;
        try {
            settled = await Promise.allSettled(list.map(
                (team) => puter.teams.listMembers(team.uid, { limit: MEMBER_PAGE_CAP }),
            ));
        } catch {
            settled = [];
        }
        /** @type {Map<string, Colleague>} */
        const by_username = new Map();
        settled.forEach((result, index) => {
            if ( result.status !== 'fulfilled' ) return;
            for ( const member of result.value ?? [] ) {
                const username = member?.username;
                if ( ! username || by_username.has(username) ) continue;
                by_username.set(username, { username, teamName: team_label(list[index]) });
            }
        });
        return [...by_username.values()];
    })();

    colleague_cache = { key, at: now, promise };
    // A roster always names at least the caller, so coming back with nobody
    // means every lookup was refused — not something to hold on to.
    promise.then((colleagues) => {
        if ( colleagues.length === 0 && colleague_cache?.promise === promise ) {
            colleague_cache = null;
        }
    });
    return promise;
};

/** Drops the roster cache. For tests, and for a change of signed-in user. */
export const forget_colleagues = () => {
    colleague_cache = null;
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

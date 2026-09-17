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

import { team_label } from './shareTeams.js';

// What the recipient field offers when it is opened: who this account shared
// with before, the teams it belongs to, and the colleagues in them. Pure, so
// the ranking rules are testable without a DOM.

/** How many rows the list shows at once; the rest is what typing is for. */
export const MAX_SUGGESTIONS = 8;

/**
 * One offer in the list.
 *
 * @typedef {Object} Suggestion
 * @property {string} key - Row identity, comparable with an access list's keys
 * @property {'user'|'invite'|'team'} kind
 * @property {string} id - Username, invited email address, or team uid
 * @property {string} name - What to show
 * @property {string|null} teamName - The team a colleague was found through
 * @property {boolean} recent - Whether this account shared with them before
 */

/**
 * Row identity: `user:<username>`, `invite:<email>` or `team:<uid>`, matching
 * the access list's keys so a person already on it can be left out.
 *
 * @param {{ kind: string, id: string }} entry
 * @returns {string}
 */
export const recipient_key = ({ kind, id }) =>
    `${kind}:${String(id ?? '').toLowerCase()}`;

/**
 * The same key for a share as listed by the backend, so a dialog holding raw
 * listings can say who is already covered.
 *
 * @param {Object} share
 * @returns {string|null} null for a link share, which is nobody in particular
 */
export const share_key = (share) => {
    if ( share?.anyone ) return null;
    if ( share?.holderTeam?.uid ) return recipient_key({ kind: 'team', id: share.holderTeam.uid });
    if ( share?.pending ) {
        return share.recipientEmail
            ? recipient_key({ kind: 'invite', id: share.recipientEmail })
            : null;
    }
    return share?.holder ? recipient_key({ kind: 'user', id: share.holder }) : null;
};

/**
 * What a share call should be given for this suggestion. A team is named by
 * uid, since a bare string is read as an email address or a username.
 *
 * @param {Suggestion} suggestion
 * @returns {string|{ team: string }}
 */
export const recipient_for = (suggestion) =>
    (suggestion.kind === 'team' ? { team: suggestion.id } : suggestion.id);

/**
 * How well a candidate answers what was typed: 0 for a leading match, 1 for a
 * match anywhere, -1 for none.
 *
 * @param {string[]} haystacks
 * @param {string} needle - already lowercased and trimmed
 * @returns {number}
 */
const match_score = (haystacks, needle) => {
    let best = -1;
    for ( const text of haystacks ) {
        const lower = text.toLowerCase();
        if ( lower.startsWith(needle) ) return 0;
        if ( best === -1 && lower.includes(needle) ) best = 1;
    }
    return best;
};

/**
 * What to offer in the recipient field.
 *
 * With nothing typed the order is recents, then teams, then colleagues — the
 * shortcut first, the broad grant next, the roster last. Typing ranks leading
 * matches above matches anywhere and keeps that order within each tier.
 *
 * A recent team the user has since left is dropped: it can no longer be shared
 * with, and its stored name may be stale. Someone already on the access list is
 * dropped too — the list below the field already accounts for them.
 *
 * @param {Object} [options]
 * @param {string} [options.query] - What is typed in the field
 * @param {Array<{ uid: string, name?: string|null, handle?: string|null }>} [options.teams]
 * @param {Array<{ username: string, teamName?: string|null }>} [options.members]
 * @param {import('./shareRecents.js').RecentRecipient[]} [options.recents]
 * @param {Set<string>|Iterable<string>} [options.exclude] - Keys already covered
 * @param {string|null} [options.self] - The signed-in username, never offered
 * @param {number} [options.limit]
 * @returns {Suggestion[]}
 */
export const build_suggestions = ({
    query = '',
    teams = [],
    members = [],
    recents = [],
    exclude = [],
    self = null,
    limit = MAX_SUGGESTIONS,
} = {}) => {
    const live_teams = new Map(teams.map((team) => [team.uid, team]));
    const member_teams = new Map(
        members.map((member) => [String(member.username).toLowerCase(), member.teamName ?? null]),
    );
    const excluded = new Set([...exclude].map((key) => String(key).toLowerCase()));
    const own = self ? String(self).toLowerCase() : null;

    /** @type {Array<Suggestion & { tier: number, search: string[] }>} */
    const candidates = [];
    const seen = new Set();

    const push = (entry, tier, search) => {
        const key = recipient_key(entry);
        if ( seen.has(key) || excluded.has(key) ) return;
        if ( entry.kind === 'user' && own && entry.id.toLowerCase() === own ) return;
        seen.add(key);
        candidates.push({ ...entry, key, tier, search: search.filter(Boolean) });
    };

    for ( const recent of recents ) {
        if ( recent.kind === 'team' ) {
            const team = live_teams.get(recent.id);
            if ( ! team ) continue;
            push(
                { kind: 'team', id: team.uid, name: team_label(team), teamName: null, recent: true },
                0,
                [team_label(team), team.handle],
            );
            continue;
        }
        // A colleague shared with before is still worth placing by their team.
        const teamName = recent.kind === 'user'
            ? member_teams.get(recent.id.toLowerCase()) ?? null
            : null;
        push(
            { kind: recent.kind, id: recent.id, name: recent.name, teamName, recent: true },
            0,
            [recent.name, recent.id],
        );
    }

    for ( const team of teams ) {
        push(
            { kind: 'team', id: team.uid, name: team_label(team), teamName: null, recent: false },
            1,
            [team_label(team), team.handle],
        );
    }

    for ( const member of members ) {
        if ( ! member?.username ) continue;
        push(
            {
                kind: 'user',
                id: member.username,
                name: member.username,
                teamName: member.teamName ?? null,
                recent: false,
            },
            2,
            [member.username],
        );
    }

    const strip = ({ key, kind, id, name, teamName, recent }) =>
        ({ key, kind, id, name, teamName, recent });

    const needle = query.trim().toLowerCase();
    if ( needle === '' ) return candidates.slice(0, limit).map(strip);

    return candidates
        .map((candidate, index) => ({
            candidate,
            index,
            score: match_score(candidate.search, needle),
        }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) =>
            a.score - b.score ||
            a.candidate.tier - b.candidate.tier ||
            a.index - b.index)
        .slice(0, limit)
        .map((entry) => strip(entry.candidate));
};

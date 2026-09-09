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

// Pure logic behind the team admin console. No DOM, no network.

/**
 * Whether the team may permanently delete this account. The API refuses a live
 * one, so offering the button before it is disabled only ever produces an error.
 *
 * @param {{ orgOwned?: boolean, disabled?: boolean }} member
 * @returns {boolean}
 */
export function canDeleteAccount (member) {
    return member?.orgOwned === true && member?.disabled === true;
}

/** i18n keys for the actions a team's audit log records. */
const AUDIT_ACTION_KEYS = {
    provision: 'teams_audit_provision',
    disable: 'teams_audit_disable',
    enable: 'teams_audit_enable',
    delete_team: 'teams_audit_delete_team',
    reset_member_password: 'teams_audit_reset_member_password',
    activate: 'teams_audit_activate',
    delete_account: 'teams_audit_delete_account',
};

/** i18n keys for the reasons the team attaches to an action. */
const AUDIT_REASON_KEYS = {
    team_deleted: 'teams_audit_reason_team_deleted',
};

/**
 * Whether each account is currently suspended, read off the audit log.
 *
 * The member listing carries no suspension flag, but every suspension and
 * restoration is recorded, so the newest `disable`/`enable` per account is the
 * current state. Entries arrive newest first, so the first match wins.
 *
 * @param {Array<{ action: string, username: string | null, reason: string | null, createdAt: string }>} entries
 * @returns {Record<string, { disabled: boolean, reason: string | null, at: string }>}
 */
export function memberStatesFromAudit (entries) {
    /** @type {Record<string, { disabled: boolean, reason: string | null, at: string }>} */
    const states = {};
    for ( const entry of entries ?? [] ) {
        const username = entry?.username;
        if ( ! username || username in states ) continue;
        if ( entry.action !== 'disable' && entry.action !== 'enable' ) continue;
        states[username] = {
            disabled: entry.action === 'disable',
            reason: entry.reason ?? null,
            at: entry.createdAt,
        };
    }
    return states;
}

/**
 * The member listing with each account's suspension state folded in.
 *
 * Only accounts the team provisioned can be suspended by it, so an
 * account that merely joined is always reported active.
 *
 * @param {Array<{ username: string, orgOwned: boolean, createdAt: string }>} members
 * @param {Array<{ action: string, username: string | null, reason: string | null, createdAt: string }>} auditEntries
 * @returns {Array<{ username: string, orgOwned: boolean, createdAt: string, disabled: boolean, disabledReason: string | null }>}
 */
export function annotateMembers (members, auditEntries) {
    const states = memberStatesFromAudit(auditEntries);
    return (members ?? []).map(member => {
        const state = member.orgOwned ? states[member.username] : undefined;
        return {
            ...member,
            disabled: state?.disabled === true,
            disabledReason: state?.disabled === true ? (state.reason ?? null) : null,
        };
    });
}

/**
 * What the team is currently being charged for. Suspended accounts are
 * counted separately because they stop costing a per-account charge and keep
 * costing for the bytes they hold — an administrator deciding what to clean up
 * needs the two apart.
 *
 * @param {Array<{ orgOwned: boolean, disabled: boolean }>} annotated
 * @returns {{ total: number, billed: number, disabled: number, joined: number }}
 */
export function membersBillingSummary (annotated) {
    const summary = { total: 0, billed: 0, disabled: 0, joined: 0 };
    for ( const member of annotated ?? [] ) {
        summary.total++;
        if ( ! member.orgOwned ) summary.joined++;
        else if ( member.disabled ) summary.disabled++;
        else summary.billed++;
    }
    return summary;
}

/**
 * The i18n key for an audit action, or `null` for one this build does not know
 * about — a new backend action must show as itself rather than as nothing.
 *
 * @param {string} action
 * @returns {string | null}
 */
export function auditActionKey (action) {
    return AUDIT_ACTION_KEYS[action] ?? null;
}

/**
 * The i18n key for a recorded reason, or `null` when there is none to show.
 *
 * @param {string | null} reason
 * @returns {string | null}
 */
export function auditReasonKey (reason) {
    return reason ? (AUDIT_REASON_KEYS[reason] ?? null) : null;
}

/**
 * Members ordered for display: suspended accounts last, then provisioned
 * before joined, then by username. Suspended accounts stay on the list rather
 * than being hidden, because they are still on the bill.
 *
 * @template {{ username: string, orgOwned: boolean, disabled: boolean }} T
 * @param {T[]} annotated
 * @returns {T[]}
 */
export function sortMembers (annotated) {
    return [...(annotated ?? [])].sort((a, b) => {
        if ( a.disabled !== b.disabled ) return a.disabled ? 1 : -1;
        if ( a.orgOwned !== b.orgOwned ) return a.orgOwned ? -1 : 1;
        return a.username.localeCompare(b.username);
    });
}

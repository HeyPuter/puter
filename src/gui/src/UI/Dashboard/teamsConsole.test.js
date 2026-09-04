import { describe, expect, it } from 'vitest';
import {
    annotateMembers,
    auditActionKey,
    canDeleteAccount,
    auditReasonKey,
    memberStatesFromAudit,
    membersBillingSummary,
    sortMembers,
} from './teamsConsole.js';

/** The audit log arrives newest first, which is what these fixtures encode. */
const entry = (action, username, createdAt, reason = null) =>
    ({ action, username, reason, createdAt, actorUsername: 'boss' });

const member = (username, orgOwned = true) =>
    ({ username, orgOwned, createdAt: '2026-01-01T00:00:00Z' });

describe('memberStatesFromAudit', () => {
    it('takes the newest disable/enable per account', () => {
        const states = memberStatesFromAudit([
            entry('enable', 'ann', '2026-03-01T00:00:00Z'),
            entry('disable', 'ann', '2026-02-01T00:00:00Z'),
            entry('disable', 'bob', '2026-02-01T00:00:00Z'),
            entry('provision', 'bob', '2026-01-01T00:00:00Z'),
        ]);
        expect(states.ann.disabled).toBe(false);
        expect(states.bob.disabled).toBe(true);
    });

    it('carries the recorded reason and time of the suspension', () => {
        const states = memberStatesFromAudit([
            entry('disable', 'ann', '2026-02-01T00:00:00Z', 'team_deleted'),
        ]);
        expect(states.ann).toEqual({
            disabled: true,
            reason: 'team_deleted',
            at: '2026-02-01T00:00:00Z',
        });
    });

    it('ignores actions that do not move an account, and entries with no account', () => {
        const states = memberStatesFromAudit([
            entry('delete_team', null, '2026-03-01T00:00:00Z'),
            entry('provision', 'ann', '2026-01-01T00:00:00Z'),
        ]);
        expect(states).toEqual({});
    });

    it('survives an empty or missing log', () => {
        expect(memberStatesFromAudit([])).toEqual({});
        expect(memberStatesFromAudit(undefined)).toEqual({});
    });
});

describe('annotateMembers', () => {
    it('marks a suspended account and keeps it on the list', () => {
        const annotated = annotateMembers(
            [member('ann'), member('bob')],
            [entry('disable', 'bob', '2026-02-01T00:00:00Z', 'team_deleted')],
        );
        expect(annotated).toHaveLength(2);
        expect(annotated.find(m => m.username === 'ann').disabled).toBe(false);
        expect(annotated.find(m => m.username === 'bob')).toMatchObject({
            disabled: true,
            disabledReason: 'team_deleted',
        });
    });

    it('never reports an account the team does not own as suspended', () => {
        // A joined account can be suspended by Puter, which is not the
        // team's to show or to lift.
        const annotated = annotateMembers(
            [member('carol', false)],
            [entry('disable', 'carol', '2026-02-01T00:00:00Z')],
        );
        expect(annotated[0].disabled).toBe(false);
    });

    it('clears the reason once an account is restored', () => {
        const annotated = annotateMembers(
            [member('ann')],
            [
                entry('enable', 'ann', '2026-03-01T00:00:00Z'),
                entry('disable', 'ann', '2026-02-01T00:00:00Z', 'team_deleted'),
            ],
        );
        expect(annotated[0]).toMatchObject({ disabled: false, disabledReason: null });
    });
});

describe('membersBillingSummary', () => {
    it('separates what is charged per account from what only costs storage', () => {
        const annotated = annotateMembers(
            [member('ann'), member('bob'), member('cat'), member('dan', false)],
            [entry('disable', 'bob', '2026-02-01T00:00:00Z')],
        );
        expect(membersBillingSummary(annotated)).toEqual({
            total: 4,
            billed: 2,
            disabled: 1,
            joined: 1,
        });
    });

    it('counts nothing for an empty team', () => {
        expect(membersBillingSummary([])).toEqual({ total: 0, billed: 0, disabled: 0, joined: 0 });
    });
});

describe('the delete gate', () => {
    // The API refuses a live account, so the button must not exist for one.
    it('offers deletion only for a disabled account the team owns', () => {
        expect(canDeleteAccount({ orgOwned: true, disabled: true })).toBe(true);
        expect(canDeleteAccount({ orgOwned: true, disabled: false })).toBe(false);
    });

    it('never offers it for an account the team merely admitted', () => {
        expect(canDeleteAccount({ orgOwned: false, disabled: true })).toBe(false);
        expect(canDeleteAccount(undefined)).toBe(false);
    });
});

describe('audit labels', () => {
    it('names the actions the team records', () => {
        expect(auditActionKey('provision')).toBe('teams_audit_provision');
        expect(auditActionKey('disable')).toBe('teams_audit_disable');
        expect(auditActionKey('enable')).toBe('teams_audit_enable');
        expect(auditActionKey('delete_team')).toBe('teams_audit_delete_team');
    });

    // The whole vocabulary `TeamService` can append, so an action added there
    // is not left rendering as its raw enum in the one view meant to read well.
    it.each([
        'provision', 'disable', 'enable', 'delete_team',
        'reset_member_password', 'activate', 'delete_account',
        'directory_enabled', 'directory_disabled',
    ])('has a label for %s', (action) => {
        expect(auditActionKey(action)).not.toBeNull();
    });

    it('returns null for an action this build does not know, so it shows as itself', () => {
        expect(auditActionKey('something_new')).toBeNull();
    });

    it('names a recorded reason, and nothing when there is none', () => {
        expect(auditReasonKey('team_deleted')).toBe('teams_audit_reason_team_deleted');
        expect(auditReasonKey('unrecognized')).toBeNull();
        expect(auditReasonKey(null)).toBeNull();
    });
});

describe('sortMembers', () => {
    it('puts suspended accounts last, provisioned before joined, then alphabetical', () => {
        const annotated = annotateMembers(
            [member('zoe'), member('ann'), member('carol', false), member('bob')],
            [entry('disable', 'ann', '2026-02-01T00:00:00Z')],
        );
        expect(sortMembers(annotated).map(m => m.username)).toEqual(['bob', 'zoe', 'carol', 'ann']);
    });

    it('does not mutate the input', () => {
        const annotated = annotateMembers([member('zoe'), member('ann')], []);
        sortMembers(annotated);
        expect(annotated.map(m => m.username)).toEqual(['zoe', 'ann']);
    });
});

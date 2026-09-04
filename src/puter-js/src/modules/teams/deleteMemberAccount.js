import { req, requireSegment } from './lib/req.js';

/**
 * Permanently removes an account the team owns: its files go, its username
 * returns to the pool, and every credential is invalidated. Owner account only.
 *
 * Irreversible, and there is no restore window. The account must already be
 * disabled — a live one is refused with `account_must_be_disabled_first`, so
 * `disableMember()` is always the step before this one.
 *
 * Disabling already ended the per-account charge; this is what ends the charge
 * for the bytes it held.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function deleteMemberAccount (uid, username) {
    const teamSegment = requireSegment(uid, 'uid');
    const userSegment = requireSegment(username, 'username');
    await req(this.puter, 'DELETE', `/teams/${teamSegment}/members/${userSegment}`, {
        operation: 'deleteMemberAccount',
    });
}

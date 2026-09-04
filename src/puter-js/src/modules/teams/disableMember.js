import { req, requireSegment } from './lib/req.js';

/**
 * Suspends an account the team owns, ending its sessions. Owner account
 * only, and reversible with `enableMember()`.
 *
 * A disabled account no longer costs a per-account charge, but the team is
 * still billed for the bytes it holds.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function disableMember (uid, username) {
    const teamSegment = requireSegment(uid, 'uid');
    const userSegment = requireSegment(username, 'username');
    await req(this.puter, 'POST', `/teams/${teamSegment}/members/${userSegment}/disable`, {
        operation: 'disableMember',
    });
}

import { req, requireSegment } from './lib/req.js';

/**
 * Restores an account previously suspended with `disableMember()`. Owner
 * account only.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function enableMember (uid, username) {
    const teamSegment = requireSegment(uid, 'uid');
    const userSegment = requireSegment(username, 'username');
    await req(this.puter, 'POST', `/teams/${teamSegment}/members/${userSegment}/enable`, {
        operation: 'enableMember',
    });
}

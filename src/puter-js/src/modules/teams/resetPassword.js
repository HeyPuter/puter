import { req, requireSegment } from './lib/req.js';

/**
 * Issues a new temporary password for an account the team owns, ending its
 * sessions. Owner account only. 2FA is left alone — a reset does not clear it.
 *
 * Unlike `resendActivation()`, this works on a live account, which is what makes
 * it the one route from a team to a member's data. What bounds it is the
 * audit row and the email the member is sent, both of which are unconditional.
 *
 * The credential is shown once and is not retrievable afterwards. It stops
 * working 24 hours after it is issued, and until the member chooses their own
 * password they can sign in and do nothing else.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {string} username
 * @returns {Promise<import('./types.js').TemporaryCredential>}
 */
export async function resetPassword (uid, username) {
    const teamSegment = requireSegment(uid, 'uid');
    const userSegment = requireSegment(username, 'username');

    const result = /** @type {Record<string, unknown>} */ (await req(
        this.puter,
        'POST',
        `/teams/${teamSegment}/members/${userSegment}/password-reset`,
        { operation: 'resetPassword' },
    ));
    return {
        username,
        temporaryPassword: /** @type {string} */ (result.temporary_password),
    };
}

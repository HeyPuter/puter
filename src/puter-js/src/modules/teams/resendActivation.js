import { req, requireSegment } from './lib/req.js';

/**
 * Issues a fresh one-time credential for an account that has never signed in,
 * invalidating the previous one. Owner account only.
 *
 * It refuses with `conflict` once the account has been activated: after that
 * the member owns their own password, and an administrator able to replace it
 * would be able to reach their data.
 *
 * The returned password is shown once and is not retrievable afterwards.
 *
 * @this {import('./index.js').TeamsModule}
 * @param {string} uid
 * @param {string} username
 * @returns {Promise<import('./types.js').TemporaryCredential>}
 */
export async function resendActivation (uid, username) {
    const teamSegment = requireSegment(uid, 'uid');
    const userSegment = requireSegment(username, 'username');

    const result = /** @type {Record<string, unknown>} */ (await req(
        this.puter,
        'POST',
        `/teams/${teamSegment}/members/${userSegment}/activation`,
        { operation: 'resendActivation' },
    ));
    return {
        username,
        temporaryPassword: /** @type {string} */ (result.temporary_password),
    };
}
